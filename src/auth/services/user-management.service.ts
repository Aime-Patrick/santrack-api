import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import { hash } from 'bcryptjs';

import {
  DuplicateException,
  NotFoundEntityException,
  TraceabilityRuleException,
} from '../../common/errors';
import { EmailService } from '../../email/email.service';
import { Organization } from '../../organization/entities/organization.entity';
import {
  CreateUserDto,
  ResetPasswordDto,
  UpdateUserDto,
} from '../dto/user-management.dto';
import { User } from '../entities/user.entity';
import { UserRole } from '../user-role.enum';

export type CreatedUserResult = Omit<User, 'passwordHash'> & {
  /** Present only when the server generated the temporary password. */
  temporaryPassword?: string;
};

/**
 * Manages user accounts within organizations. An org admin can invite and
 * manage users inside their own company; a system admin can act across all
 * organizations.
 */
@Injectable()
export class UserManagementService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(Organization)
    private readonly organizations: Repository<Organization>,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Creates a new user within an organization. The caller must belong to the
   * same organization (or be a system admin). Invited accounts always require
   * a password change on first sign-in.
   */
  async create(actor: User, dto: CreateUserDto): Promise<CreatedUserResult> {
    const email = dto.email.trim().toLowerCase();

    if (await this.users.findOne({ where: { email } })) {
      throw new DuplicateException(`${email} is already registered`);
    }

    const organization = await this.organizations.findOne({
      where: { id: dto.organizationId },
    });
    if (!organization) {
      throw new NotFoundEntityException('Organization', dto.organizationId);
    }

    if (
      actor.role !== UserRole.SYSTEM_ADMIN &&
      actor.organization?.id !== organization.id
    ) {
      throw new TraceabilityRuleException(
        'You can only create users within your own organization',
      );
    }

    if (actor.role !== UserRole.SYSTEM_ADMIN && dto.role === UserRole.SYSTEM_ADMIN) {
      throw new TraceabilityRuleException(
        'Only system administrators can assign the SYSTEM_ADMIN role',
      );
    }

    const generate = dto.generatePassword === true || !dto.password;
    const temporaryPassword = generate
      ? generateTemporaryPassword()
      : dto.password!.trim();

    if (temporaryPassword.length < 8) {
      throw new TraceabilityRuleException(
        'Password must be at least 8 characters',
      );
    }

    const fullName = dto.fullName?.trim() || null;

    const user = await this.users.save(
      this.users.create({
        email,
        passwordHash: await hash(temporaryPassword, 10),
        fullName,
        organization,
        role: dto.role,
        mustChangePassword: true,
      }),
    );

    const appUrl = this.appPublicUrl();
    void this.email
      .sendInviteEmail({
        to: email,
        name: fullName ?? email,
        organizationName: organization.name,
        role: dto.role,
        temporaryPassword,
        inviterName: actor.fullName ?? actor.email,
        loginUrl: `${appUrl}/login`,
      })
      .catch(() => undefined);

    return {
      ...this.describe(user),
      ...(generate ? { temporaryPassword } : {}),
    };
  }

  async list(
    actor: User,
    organizationId?: number,
  ): Promise<Omit<User, 'passwordHash'>[]> {
    const orgId = this.resolveOrgId(actor, organizationId);

    const where: Record<string, unknown> = {};
    if (orgId) {
      where.organization = { id: orgId };
    }

    const users = await this.users.find({
      where,
      order: { createdAt: 'DESC' },
      relations: { organization: true },
    });

    return users.map((u) => this.describe(u));
  }

  async get(actor: User, userId: number): Promise<Omit<User, 'passwordHash'>> {
    const user = await this.users.findOne({
      where: { id: userId },
      relations: { organization: true },
    });
    if (!user) {
      throw new NotFoundEntityException('User', userId);
    }

    this.requireVisible(actor, user);

    return this.describe(user);
  }

  async update(
    actor: User,
    userId: number,
    dto: UpdateUserDto,
  ): Promise<Omit<User, 'passwordHash'>> {
    const user = await this.users.findOne({
      where: { id: userId },
      relations: { organization: true },
    });
    if (!user) {
      throw new NotFoundEntityException('User', userId);
    }

    this.requireVisible(actor, user);

    if (
      actor.role !== UserRole.SYSTEM_ADMIN &&
      dto.role === UserRole.SYSTEM_ADMIN
    ) {
      throw new TraceabilityRuleException(
        'Only system administrators can assign the SYSTEM_ADMIN role',
      );
    }

    if (dto.fullName !== undefined) {
      user.fullName = dto.fullName.trim() || null;
    }

    if (dto.role !== undefined) {
      user.role = dto.role;
    }

    if (dto.organizationId !== undefined) {
      const org = await this.organizations.findOne({
        where: { id: dto.organizationId },
      });
      if (!org) {
        throw new NotFoundEntityException('Organization', dto.organizationId);
      }
      user.organization = org;
    }

    const saved = await this.users.save(user);
    return this.describe(saved);
  }

  async resetPassword(
    actor: User,
    userId: number,
    dto: ResetPasswordDto,
  ): Promise<void> {
    const user = await this.users.findOne({
      where: { id: userId },
      relations: { organization: true },
    });
    if (!user) {
      throw new NotFoundEntityException('User', userId);
    }

    this.requireVisible(actor, user);

    const temporaryPassword = dto.password.trim();
    if (temporaryPassword.length < 8) {
      throw new TraceabilityRuleException(
        'Password must be at least 8 characters',
      );
    }

    user.passwordHash = await hash(temporaryPassword, 10);
    user.mustChangePassword = true;
    await this.users.save(user);

    const appUrl = this.appPublicUrl();
    void this.email
      .sendAdminPasswordResetEmail({
        to: user.email,
        name: user.fullName ?? user.email,
        organizationName: user.organization?.name ?? null,
        temporaryPassword,
        resetBy: actor.fullName ?? actor.email,
        loginUrl: `${appUrl}/login`,
      })
      .catch(() => undefined);
  }

  async remove(actor: User, userId: number): Promise<void> {
    if (actor.id === userId) {
      throw new TraceabilityRuleException('You cannot deactivate your own account');
    }

    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundEntityException('User', userId);
    }

    this.requireVisible(actor, user);

    await this.users.remove(user);
  }

  private resolveOrgId(actor: User, requested?: number): number | null {
    if (actor.role === UserRole.SYSTEM_ADMIN) {
      return requested ?? null;
    }
    if (!actor.organization) {
      throw new TraceabilityRuleException(
        'Complete organization setup before managing users',
      );
    }
    if (requested && requested !== actor.organization.id) {
      throw new TraceabilityRuleException(
        'You can only view users within your own organization',
      );
    }
    return actor.organization.id;
  }

  private requireVisible(actor: User, target: User): void {
    if (actor.role === UserRole.SYSTEM_ADMIN) return;
    if (!actor.organization) {
      throw new TraceabilityRuleException(
        'Complete organization setup before managing users',
      );
    }
    if (target.organization?.id !== actor.organization.id) {
      throw new NotFoundEntityException('User', target.id);
    }
  }

  private describe(user: User): Omit<User, 'passwordHash'> {
    const { passwordHash: _, ...rest } = user as User & { passwordHash: string };
    return rest;
  }

  private appPublicUrl(): string {
    const configured = this.config.get<string>('appPublicUrl');
    if (configured) return configured.replace(/\/$/, '');
    const origins = this.config.get<string[]>('corsOrigins') ?? [];
    return (origins[0] ?? 'http://localhost:3000').replace(/\/$/, '');
  }
}

/** Readable temporary password: no ambiguous characters (0/O, 1/l). */
function generateTemporaryPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = randomBytes(12);
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += alphabet[bytes[i]! % alphabet.length];
  }
  return out;
}
