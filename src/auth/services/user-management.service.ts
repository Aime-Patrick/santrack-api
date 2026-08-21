import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { hash } from 'bcryptjs';

import {
  DuplicateException,
  NotFoundEntityException,
  TraceabilityRuleException,
} from '../../common/errors';
import { Organization } from '../../organization/entities/organization.entity';
import { CreateUserDto, ResetPasswordDto, UpdateUserDto } from '../dto/user-management.dto';
import { User } from '../entities/user.entity';
import { UserRole } from '../user-role.enum';

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
  ) {}

  /**
   * Creates a new user within an organization. The caller must belong to the
   * same organization (or be a system admin).
   */
  async create(
    actor: User,
    dto: CreateUserDto,
  ): Promise<User> {
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

    // Non-system admins can only create users in their own organization.
    if (
      actor.role !== UserRole.SYSTEM_ADMIN &&
      actor.organization?.id !== organization.id
    ) {
      throw new TraceabilityRuleException(
        'You can only create users within your own organization',
      );
    }

    const user = await this.users.save(
      this.users.create({
        email,
        passwordHash: await hash(dto.password, 10),
        fullName: dto.fullName.trim(),
        organization,
        role: dto.role,
      }),
    );

    return this.describe(user);
  }

  /**
   * Lists users, optionally filtered by organization. System admins see all
   * users; org admins see only their own organization's users.
   */
  async list(
    actor: User,
    organizationId?: number,
  ): Promise<User[]> {
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

  /**
   * Returns one user by ID. System admins can see anyone; org admins can
   * only see users in their own organization.
   */
  async get(actor: User, userId: number): Promise<User> {
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

  /**
   * Updates a user's profile or role. System admins can change anything;
   * org admins can only modify users within their own organization and
   * cannot promote anyone to SYSTEM_ADMIN.
   */
  async update(
    actor: User,
    userId: number,
    dto: UpdateUserDto,
  ): Promise<User> {
    const user = await this.users.findOne({
      where: { id: userId },
      relations: { organization: true },
    });
    if (!user) {
      throw new NotFoundEntityException('User', userId);
    }

    this.requireVisible(actor, user);

    // Org admins cannot promote to SYSTEM_ADMIN.
    if (
      actor.role !== UserRole.SYSTEM_ADMIN &&
      dto.role === UserRole.SYSTEM_ADMIN
    ) {
      throw new TraceabilityRuleException(
        'Only system administrators can assign the SYSTEM_ADMIN role',
      );
    }

    if (dto.fullName !== undefined) {
      user.fullName = dto.fullName.trim();
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

  /**
   * Resets a user's password. System admins can reset anyone's; org admins
   * can only reset passwords for users in their own organization.
   */
  async resetPassword(
    actor: User,
    userId: number,
    dto: ResetPasswordDto,
  ): Promise<void> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundEntityException('User', userId);
    }

    this.requireVisible(actor, user);

    user.passwordHash = await hash(dto.password, 10);
    await this.users.save(user);
  }

  /**
   * Deactivates a user by removing them. A system admin can deactivate
   * anyone; an org admin can only deactivate users in their own org.
   * A user cannot deactivate themselves.
   */
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

  // ── helpers ────────────────────────────────────────────────────────

  /**
   * Resolves which organization to filter by. System admins can pass any
   * org ID (or none for all). Org admins are locked to their own.
   */
  private resolveOrgId(actor: User, requested?: number): number | null {
    if (actor.role === UserRole.SYSTEM_ADMIN) {
      return requested ?? null; // null = all organizations
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

  /** Ensures the actor can see the target user. */
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

  /** Strips the password hash before returning a user. */
  private describe(user: User): User {
    const { passwordHash: _, ...rest } = user as User & { passwordHash: string };
    return rest as User;
  }
}
