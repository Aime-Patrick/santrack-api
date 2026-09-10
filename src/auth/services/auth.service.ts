import { createHash, randomBytes } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { compare, hash } from 'bcryptjs';

import {
  DuplicateException,
  InvalidCredentialsException,
  TraceabilityRuleException,
} from '../../common/errors';
import { Organization } from '../../organization/entities/organization.entity';
import { ChangePasswordDto } from '../dto/user-management.dto';
import {
  LoginDto,
  RegisterDto,
  RequestPasswordResetDto,
  ResetPasswordDto,
} from '../dto/auth.dto';
import { EmailService } from '../../email/email.service';
import {
  CAPABILITIES_CONFERRED_BY_ORGANIZATION_TYPE,
  CAPABILITY_DESCRIPTIONS,
  Capability,
  capabilitiesFor,
} from '../capabilities';
import { User } from '../entities/user.entity';
import { UserRole } from '../user-role.enum';

export interface AuthResult {
  token: string;
  user: {
    id: number;
    email: string;
    fullName: string | null;
    role: UserRole;
    organization: {
      id: number;
      name: string;
      type: string;
      onboardingStatus: string;
    } | null;
    mustChangePassword: boolean;
    /**
     * Everything this person may do, already resolved from their role and
     * their organization's standing.
     *
     * The browser used to keep its own copy of the capability table, which
     * drifted: a production manager was shown the industry registry because
     * the copy was a year out of date. Sending the answer rather than the
     * inputs means the navigation cannot disagree with the guard.
     */
    capabilities: Capability[];
  };
}

/** The role/capability reference table, as the Roles screen consumes it. */
export interface CapabilityCatalogue {
  capabilities: {
    capability: Capability;
    description: string;
    /** True when standing, not job title, is what grants it. */
    conferredByStanding: boolean;
  }[];
  roles: { role: UserRole; capabilities: Capability[] }[];
  standing: { organizationType: string; capabilities: Capability[] }[];
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly appPublicUrl: string;

  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly jwt: JwtService,
    private readonly email: EmailService,
    config: ConfigService,
  ) {
    this.appPublicUrl = (
      config.get<string>('appPublicUrl') ??
      (config.get<string[]>('corsOrigins') ?? ['http://localhost:3000'])[0] ??
      'http://localhost:3000'
    ).replace(/\/$/, '');
  }

  /**
   * Creates an account. The first user of an organization becomes its admin
   * during onboarding; until they complete organization setup they hold no
   * position in any chain of custody.
   */
  async register(dto: RegisterDto): Promise<AuthResult> {
    const email = dto.email.trim().toLowerCase();

    if (await this.users.findOne({ where: { email } })) {
      throw new DuplicateException(`${email} is already registered`);
    }

    const user = await this.users.save(
      this.users.create({
        email,
        passwordHash: await hash(dto.password, 10),
        fullName: dto.fullName.trim(),
        role: UserRole.ORG_ADMIN,
        organization: null,
        mustChangePassword: false,
      }),
    );

    return this.issue(user);
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const email = dto.email.trim().toLowerCase();

    // The hash is not selected by default, so it is asked for explicitly here
    // and nowhere else.
    const user = await this.users.findOne({
      where: { email },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        passwordHash: true,
        mustChangePassword: true,
      },
      relations: { organization: true },
    });

    // The same error whether the account is unknown or the password is wrong,
    // so the response cannot be used to discover which emails are registered.
    if (!user || !(await compare(dto.password, user.passwordHash))) {
      throw new InvalidCredentialsException();
    }

    return this.issue(user);
  }

  /**
   * Replaces the caller's password. Required after an invite or admin reset
   * (`mustChangePassword`), and available anytime from account settings.
   */
  async changePassword(actor: User, dto: ChangePasswordDto): Promise<AuthResult> {
    const user = await this.users.findOne({
      where: { id: actor.id },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        passwordHash: true,
        mustChangePassword: true,
      },
      relations: { organization: true },
    });
    if (!user) {
      throw new InvalidCredentialsException();
    }

    if (!(await compare(dto.currentPassword, user.passwordHash))) {
      throw new TraceabilityRuleException('Current password is incorrect');
    }

    if (dto.currentPassword === dto.newPassword) {
      throw new TraceabilityRuleException(
        'New password must be different from the current password',
      );
    }

    user.passwordHash = await hash(dto.newPassword, 10);
    user.mustChangePassword = false;
    await this.users.save(user);

    return this.issue(user);
  }

  async me(user: User): Promise<AuthResult['user']> {
    return this.describe(user);
  }

  /**
   * Self-service profile update — lets a user change their own display name.
   * Returns a fresh /me payload so the client can update its cache in one step.
   */
  async updateProfile(
    actor: User,
    dto: { fullName?: string },
  ): Promise<AuthResult['user']> {
    const user = await this.users.findOne({
      where: { id: actor.id },
      relations: { organization: true },
    });
    if (!user) throw new InvalidCredentialsException();

    if (dto.fullName !== undefined) {
      user.fullName = dto.fullName.trim() || null;
    }
    await this.users.save(user);
    return this.describe(user);
  }

  /**
   * Starts a self-service password reset.
   *
   * Always answers success - whether or not the email is registered - so the
   * endpoint cannot be used to discover which addresses have accounts. When
   * the account exists, a single-use token (1h expiry, stored as its SHA-256)
   * is created and emailed; a delivery failure is logged, never surfaced,
   * because the caller must not learn anything from it either.
   */
  async requestPasswordReset(dto: RequestPasswordResetDto): Promise<{ success: true }> {
    const email = dto.email.trim().toLowerCase();
    const user = await this.users.findOne({ where: { email } });

    if (user) {
      const token = randomBytes(32).toString('hex');
      user.passwordResetToken = this.hashResetToken(token);
      user.passwordResetExpiresAt = new Date(Date.now() + 60 * 60 * 1000);
      await this.users.save(user);

      void this.email
        .sendForgotPasswordEmail(email, token, this.appPublicUrl)
        .catch((error: Error) =>
          this.logger.warn(
            `Password reset email to ${email} failed: ${error.message}`,
          ),
        );
    }

    return { success: true };
  }

  /**
   * Consumes the emailed token and sets a new password. One use only: the
   * token is nulled on success, so a replay of the same link fails.
   */
  async resetPassword(dto: ResetPasswordDto): Promise<{ success: true }> {
    const user = await this.users.findOne({
      where: { passwordResetToken: this.hashResetToken(dto.token) },
      select: {
        id: true,
        passwordResetToken: true,
        passwordResetExpiresAt: true,
        passwordHash: true,
        mustChangePassword: true,
      },
    });

    if (
      !user ||
      !user.passwordResetExpiresAt ||
      user.passwordResetExpiresAt.getTime() <= Date.now()
    ) {
      throw new TraceabilityRuleException(
        'This reset link is invalid or has expired. Request a new one.',
      );
    }

    user.passwordHash = await hash(dto.newPassword, 10);
    user.mustChangePassword = false;
    user.passwordResetToken = null;
    user.passwordResetExpiresAt = null;
    await this.users.save(user);

    return { success: true };
  }

  private hashResetToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * The reference table behind the Roles screen: every capability the platform
   * defines, what each one means, and which roles hold it.
   *
   * Served rather than duplicated in the browser for the same reason `me`
   * carries a resolved list - there is one table, and it lives in
   * capabilities.ts.
   */
  catalogue(): CapabilityCatalogue {
    return {
      capabilities: Object.values(Capability).map((capability) => ({
        capability,
        description: CAPABILITY_DESCRIPTIONS[capability],
        conferredByStanding: Object.values(
          CAPABILITIES_CONFERRED_BY_ORGANIZATION_TYPE,
        ).some((list) => list?.includes(capability)),
      })),
      roles: Object.values(UserRole).map((role) => ({
        role,
        capabilities: capabilitiesFor(role),
      })),
      standing: Object.entries(CAPABILITIES_CONFERRED_BY_ORGANIZATION_TYPE).map(
        ([organizationType, capabilities]) => ({
          organizationType,
          capabilities: capabilities ?? [],
        }),
      ),
    };
  }

  private async issue(user: User): Promise<AuthResult> {
    const token = await this.jwt.signAsync({ sub: user.id });
    return { token, user: this.describe(user) };
  }

  private describe(user: User): AuthResult['user'] {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      organization: user.organization
        ? {
            id: user.organization.id,
            name: user.organization.name,
            type: user.organization.type,
            onboardingStatus: user.organization.onboardingStatus,
          }
        : null,
      mustChangePassword: !!user.mustChangePassword,
      capabilities: capabilitiesFor(
        user.role,
        user.organization?.type,
        (user.extraCapabilities ?? []) as Capability[],
      ),
    };
  }
}

export function describeOrganization(organization: Organization) {
  return {
    id: organization.id,
    name: organization.name,
    type: organization.type,
  };
}
