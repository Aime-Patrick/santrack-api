import { createHash, randomBytes } from 'crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { generateSecret, generateURI, verify } from 'otplib';
import * as QRCode from 'qrcode';
import { Repository } from 'typeorm';
import { compare, hash } from 'bcryptjs';

import {
  DuplicateException,
  InvalidCredentialsException,
  TraceabilityRuleException,
} from '../../common/errors';
import { Organization } from '../../organization/entities/organization.entity';
import { OrganizationType } from '../../organization/organization-type.enum';
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
import { BCRYPT_ROUNDS } from '../password-policy';
import {
  decryptSecret,
  encryptSecret,
  MFA_TOKEN_PURPOSE,
} from '../session-cookie';
import { User } from '../entities/user.entity';
import { UserRole } from '../user-role.enum';
import { SecurityEventsService } from '../../security/security-events.service';
import {
  STORAGE_PROVIDER,
  StorageProvider,
} from '../../storage/storage.provider';

/** Local DiceBear library ref: dicebear:{style}:{seed} */
const LIBRARY_AVATAR_RE =
  /^dicebear:(notionists|avataaars|lorelei|bottts):[A-Za-z0-9_-]+$/;

/** Legacy CDN URLs from the first avatar iteration — still accepted. */
const LEGACY_CDN_AVATAR_RE =
  /^https:\/\/api\.dicebear\.com\/9\.x\/(notionists|avataaars|lorelei|bottts)\/svg\?seed=[A-Za-z0-9_-]+$/;

const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export interface AuthResult {
  token: string;
  user: {
    id: number;
    email: string;
    pendingEmail: string | null;
    pendingEmailExpiresAt: string | null;
    fullName: string | null;
    role: UserRole;
    organization: {
      id: number;
      name: string;
      type: string;
      onboardingStatus: string;
    } | null;
    mustChangePassword: boolean;
    mfaEnabled: boolean;
    /** True for SYSTEM_ADMIN / regulator staff until they enroll TOTP. */
    mustEnableMfa: boolean;
    /** Library (DiceBear) URL when set; null if using an upload or none. */
    avatarUrl: string | null;
    /** True when a custom photo is stored (fetch via GET /api/auth/me/avatar). */
    avatarUploaded: boolean;
    /**
     * Everything this person may do, already resolved from their role and
     * their organization's standing.
     */
    capabilities: Capability[];
  };
}

/** Email stays on the current address until the new inbox confirms (30 min). */
const EMAIL_CHANGE_TTL_MS = 30 * 60 * 1000;
const EMAIL_CHANGE_EXPIRES_LABEL = '30 minutes';

export interface MfaChallengeResult {
  mfaRequired: true;
  mfaToken: string;
}

export type LoginResult = AuthResult | MfaChallengeResult;

/** The role/capability reference table, as the Roles screen consumes it. */
export interface CapabilityCatalogue {
  capabilities: {
    capability: Capability;
    description: string;
    conferredByStanding: boolean;
  }[];
  roles: { role: UserRole; capabilities: Capability[] }[];
  standing: { organizationType: string; capabilities: Capability[] }[];
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly appPublicUrl: string;
  private readonly jwtSecret: string;

  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly jwt: JwtService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
    private readonly securityEvents: SecurityEventsService,
    @Inject(STORAGE_PROVIDER)
    private readonly storage: StorageProvider,
  ) {
    this.appPublicUrl = (
      config.get<string>('appPublicUrl') ??
      (config.get<string[]>('corsOrigins') ?? ['http://localhost:3000'])[0] ??
      'http://localhost:3000'
    ).replace(/\/$/, '');
    this.jwtSecret = config.get<string>('jwt.secret') ?? '';
  }

  async register(dto: RegisterDto): Promise<AuthResult> {
    const email = dto.email.trim().toLowerCase();

    if (await this.users.findOne({ where: { email } })) {
      throw new DuplicateException(`${email} is already registered`);
    }

    const user = await this.users.save(
      this.users.create({
        email,
        passwordHash: await hash(dto.password, BCRYPT_ROUNDS),
        fullName: dto.fullName.trim(),
        role: UserRole.ORG_ADMIN,
        organization: null,
        mustChangePassword: false,
        mfaEnabled: false,
      }),
    );

    return this.issue(user);
  }

  async login(dto: LoginDto, clientIp?: string): Promise<LoginResult> {
    const email = dto.email.trim().toLowerCase();

    const user = await this.users.findOne({
      where: { email },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        passwordHash: true,
        mustChangePassword: true,
        mfaEnabled: true,
        avatarUrl: true,
        avatarKey: true,
      },
      relations: { organization: true },
    });

    if (!user || !(await compare(dto.password, user.passwordHash))) {
      this.securityEvents.emit({
        event: 'auth.login_failed',
        email,
        ip: clientIp ?? null,
      });
      throw new InvalidCredentialsException();
    }

    if (user.mfaEnabled) {
      this.securityEvents.emit({
        event: 'auth.mfa_challenge',
        userId: user.id,
        ip: clientIp ?? null,
      });
      const mfaToken = await this.jwt.signAsync(
        { sub: user.id, purpose: MFA_TOKEN_PURPOSE },
        { expiresIn: '5m' },
      );
      return { mfaRequired: true, mfaToken };
    }

    this.securityEvents.emit({
      event: 'auth.login_succeeded',
      userId: user.id,
      ip: clientIp ?? null,
    });
    return this.issue(user);
  }

  async verifyMfaLogin(
    mfaToken: string,
    code: string,
    clientIp?: string,
  ): Promise<AuthResult> {
    let userId: number;
    try {
      const payload = await this.jwt.verifyAsync<{
        sub: number;
        purpose?: string;
      }>(mfaToken);
      if (payload.purpose !== MFA_TOKEN_PURPOSE) {
        throw new Error('wrong purpose');
      }
      userId = payload.sub;
    } catch {
      throw new TraceabilityRuleException(
        'MFA session expired. Sign in again.',
      );
    }

    const user = await this.users.findOne({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        mustChangePassword: true,
        mfaEnabled: true,
        mfaSecret: true,
        avatarUrl: true,
        avatarKey: true,
      },
      relations: { organization: true },
    });

    if (!user?.mfaEnabled || !user.mfaSecret) {
      throw new TraceabilityRuleException('MFA is not enabled for this account');
    }

    const secret = decryptSecret(user.mfaSecret, this.jwtSecret);
    const result = await verify({ secret, token: code.trim() });
    if (!result.valid) {
      this.securityEvents.emit({
        event: 'auth.mfa_failed',
        userId: user.id,
        ip: clientIp ?? null,
      });
      throw new TraceabilityRuleException('Invalid authenticator code');
    }

    this.securityEvents.emit({
      event: 'auth.login_succeeded',
      userId: user.id,
      mfa: true,
      ip: clientIp ?? null,
    });
    return this.issue(user);
  }

  async beginMfaSetup(actor: User): Promise<{
    secret: string;
    otpauthUrl: string;
    qrDataUrl: string;
  }> {
    const user = await this.users.findOne({
      where: { id: actor.id },
      select: { id: true, email: true, mfaEnabled: true, mfaSecret: true },
    });
    if (!user) throw new InvalidCredentialsException();
    if (user.mfaEnabled) {
      throw new TraceabilityRuleException('MFA is already enabled');
    }

    const secret = generateSecret();
    user.mfaSecret = encryptSecret(secret, this.jwtSecret);
    user.mfaEnabled = false;
    await this.users.save(user);

    const otpauthUrl = generateURI({
      strategy: 'totp',
      issuer: 'SanTrack',
      label: user.email,
      secret,
    });
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl, {
      margin: 1,
      width: 220,
    });
    return { secret, otpauthUrl, qrDataUrl };
  }

  async confirmMfaSetup(actor: User, code: string): Promise<AuthResult['user']> {
    const user = await this.users.findOne({
      where: { id: actor.id },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        mustChangePassword: true,
        mfaEnabled: true,
        mfaSecret: true,
        avatarUrl: true,
        avatarKey: true,
      },
      relations: { organization: true },
    });
    if (!user?.mfaSecret) {
      throw new TraceabilityRuleException('Start MFA setup before confirming');
    }

    const secret = decryptSecret(user.mfaSecret, this.jwtSecret);
    const result = await verify({ secret, token: code.trim() });
    if (!result.valid) {
      throw new TraceabilityRuleException('Invalid authenticator code');
    }

    user.mfaEnabled = true;
    await this.users.save(user);
    this.securityEvents.emit({ event: 'auth.mfa_enabled', userId: user.id });
    return this.describe(user);
  }

  async disableMfa(
    actor: User,
    password: string,
    code: string,
  ): Promise<AuthResult['user']> {
    const user = await this.users.findOne({
      where: { id: actor.id },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        passwordHash: true,
        mustChangePassword: true,
        mfaEnabled: true,
        mfaSecret: true,
        avatarUrl: true,
        avatarKey: true,
      },
      relations: { organization: true },
    });
    if (!user) throw new InvalidCredentialsException();
    if (!(await compare(password, user.passwordHash))) {
      throw new TraceabilityRuleException('Current password is incorrect');
    }
    if (!user.mfaEnabled || !user.mfaSecret) {
      throw new TraceabilityRuleException('MFA is not enabled');
    }

    const secret = decryptSecret(user.mfaSecret, this.jwtSecret);
    const result = await verify({ secret, token: code.trim() });
    if (!result.valid) {
      throw new TraceabilityRuleException('Invalid authenticator code');
    }

    user.mfaEnabled = false;
    user.mfaSecret = null;
    await this.users.save(user);
    this.securityEvents.emit({ event: 'auth.mfa_disabled', userId: user.id });
    return this.describe(user);
  }

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
        mfaEnabled: true,
        avatarUrl: true,
        avatarKey: true,
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

    user.passwordHash = await hash(dto.newPassword, BCRYPT_ROUNDS);
    user.mustChangePassword = false;
    await this.users.save(user);

    return this.issue(user);
  }

  async me(user: User): Promise<AuthResult['user']> {
    return this.describe(user);
  }

  async updateProfile(
    actor: User,
    dto: { fullName?: string; avatarUrl?: string | null },
  ): Promise<AuthResult['user']> {
    const user = await this.users.findOne({
      where: { id: actor.id },
      relations: { organization: true },
    });
    if (!user) throw new InvalidCredentialsException();

    if (dto.fullName !== undefined) {
      user.fullName = dto.fullName.trim() || null;
    }

    if (dto.avatarUrl !== undefined) {
      await this.applyLibraryAvatar(user, dto.avatarUrl);
    }

    await this.users.save(user);
    return this.describe(user);
  }

  /**
   * Self-service email change. Current address stays until the new inbox
   * confirms via a short-lived link. Password required to start the change.
   */
  async requestEmailChange(
    actor: User,
    dto: { email: string; password: string },
  ): Promise<AuthResult['user']> {
    const user = await this.users.findOne({
      where: { id: actor.id },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        fullName: true,
        pendingEmail: true,
        emailChangeExpiresAt: true,
        role: true,
        mfaEnabled: true,
        mustChangePassword: true,
        avatarUrl: true,
        avatarKey: true,
        extraCapabilities: true,
      },
      relations: { organization: true },
    });
    if (!user) throw new InvalidCredentialsException();

    const passwordOk = await compare(dto.password, user.passwordHash);
    if (!passwordOk) {
      throw new TraceabilityRuleException('Current password is incorrect');
    }

    return this.beginEmailChange(user, dto.email);
  }

  /**
   * Start (or replace) a pending email change for any loaded user row.
   * Used by self-service and by org admins.
   */
  async beginEmailChange(user: User, rawEmail: string): Promise<AuthResult['user']> {
    const newEmail = rawEmail.trim().toLowerCase();
    if (!newEmail) {
      throw new TraceabilityRuleException('A valid email address is required');
    }
    if (newEmail === user.email.trim().toLowerCase()) {
      throw new TraceabilityRuleException('That is already the current email');
    }

    const taken = await this.users.findOne({ where: { email: newEmail } });
    if (taken && taken.id !== user.id) {
      throw new DuplicateException(`${newEmail} is already registered`);
    }

    const pendingClash = await this.users
      .createQueryBuilder('u')
      .where('LOWER(u.pending_email) = :email', { email: newEmail })
      .andWhere('u.id != :id', { id: user.id })
      .andWhere('u.email_change_expires_at > :now', { now: new Date() })
      .getOne();
    if (pendingClash) {
      throw new TraceabilityRuleException(
        'That email is already pending verification on another account',
      );
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + EMAIL_CHANGE_TTL_MS);
    user.pendingEmail = newEmail;
    user.emailChangeToken = this.hashResetToken(token);
    user.emailChangeExpiresAt = expiresAt;
    await this.users.save(user);

    const baseUrl = this.appPublicUrl;
    void this.email
      .sendEmailChangeVerify({
        to: newEmail,
        name: user.fullName,
        pendingEmail: newEmail,
        token,
        baseUrl,
        expiresIn: EMAIL_CHANGE_EXPIRES_LABEL,
      })
      .catch((error: Error) =>
        this.logger.warn(
          `Email-change verify to ${newEmail} failed: ${error.message}`,
        ),
      );
    void this.email
      .sendEmailChangeNotice({
        to: user.email,
        name: user.fullName,
        pendingEmail: newEmail,
        expiresIn: EMAIL_CHANGE_EXPIRES_LABEL,
      })
      .catch((error: Error) =>
        this.logger.warn(
          `Email-change notice to ${user.email} failed: ${error.message}`,
        ),
      );

    const refreshed = await this.users.findOne({
      where: { id: user.id },
      relations: { organization: true },
    });
    return this.describe(refreshed ?? user);
  }

  async cancelEmailChange(actor: User): Promise<AuthResult['user']> {
    const user = await this.users.findOne({
      where: { id: actor.id },
      relations: { organization: true },
    });
    if (!user) throw new InvalidCredentialsException();
    user.pendingEmail = null;
    user.emailChangeToken = null;
    user.emailChangeExpiresAt = null;
    await this.users.save(user);
    return this.describe(user);
  }

  async verifyEmailChange(token: string): Promise<{ success: true; email: string }> {
    const user = await this.users.findOne({
      where: { emailChangeToken: this.hashResetToken(token) },
      select: {
        id: true,
        email: true,
        pendingEmail: true,
        emailChangeToken: true,
        emailChangeExpiresAt: true,
      },
    });

    if (
      !user ||
      !user.pendingEmail ||
      !user.emailChangeExpiresAt ||
      user.emailChangeExpiresAt.getTime() <= Date.now()
    ) {
      throw new TraceabilityRuleException(
        'This verification link is invalid or has expired. Request a new email change.',
      );
    }

    const clash = await this.users.findOne({ where: { email: user.pendingEmail } });
    if (clash && clash.id !== user.id) {
      const contested = user.pendingEmail;
      user.pendingEmail = null;
      user.emailChangeToken = null;
      user.emailChangeExpiresAt = null;
      await this.users.save(user);
      throw new DuplicateException(`${contested} is already registered`);
    }

    const nextEmail = user.pendingEmail;
    user.email = nextEmail;
    user.pendingEmail = null;
    user.emailChangeToken = null;
    user.emailChangeExpiresAt = null;
    await this.users.save(user);

    return { success: true, email: nextEmail };
  }

  /**
   * Pick a DiceBear library avatar (or clear with null). Replaces any upload.
   */
  async setLibraryAvatar(
    actor: User,
    avatarUrl: string | null,
  ): Promise<AuthResult['user']> {
    const user = await this.users.findOne({
      where: { id: actor.id },
      relations: { organization: true },
    });
    if (!user) throw new InvalidCredentialsException();
    await this.applyLibraryAvatar(user, avatarUrl);
    await this.users.save(user);
    return this.describe(user);
  }

  async uploadAvatar(
    actor: User,
    file: { originalname: string; mimetype: string; buffer: Buffer; size: number },
  ): Promise<AuthResult['user']> {
    if (!AVATAR_MIME.has(file.mimetype)) {
      throw new TraceabilityRuleException(
        'Avatar must be a JPEG, PNG, WebP, or GIF image',
      );
    }
    if (file.size <= 0 || file.size > AVATAR_MAX_BYTES) {
      throw new TraceabilityRuleException('Avatar must be between 1 byte and 2 MB');
    }

    const user = await this.users.findOne({
      where: { id: actor.id },
      relations: { organization: true },
    });
    if (!user) throw new InvalidCredentialsException();

    const previousKey = user.avatarKey;
    const stored = await this.storage.put({
      folder: `avatars/${user.id}`,
      filename: file.originalname || 'avatar.png',
      contentType: file.mimetype,
      content: file.buffer,
    });

    user.avatarKey = stored.key;
    user.avatarUrl = null;
    await this.users.save(user);

    if (previousKey && previousKey !== stored.key) {
      await this.storage.delete(previousKey).catch(() => undefined);
    }

    return this.describe(user);
  }

  async clearAvatar(actor: User): Promise<AuthResult['user']> {
    const user = await this.users.findOne({
      where: { id: actor.id },
      relations: { organization: true },
    });
    if (!user) throw new InvalidCredentialsException();

    const previousKey = user.avatarKey;
    user.avatarUrl = null;
    user.avatarKey = null;
    await this.users.save(user);

    if (previousKey) {
      await this.storage.delete(previousKey).catch(() => undefined);
    }

    return this.describe(user);
  }

  async readAvatar(
    actor: User,
  ): Promise<{ content: Buffer; contentType: string } | null> {
    const user = await this.users.findOne({
      where: { id: actor.id },
      select: { id: true, avatarKey: true },
    });
    if (!user?.avatarKey) return null;
    const content = await this.storage.get(user.avatarKey);
    const contentType = guessImageType(user.avatarKey);
    return { content, contentType };
  }

  private async applyLibraryAvatar(
    user: User,
    avatarUrl: string | null,
  ): Promise<void> {
    if (avatarUrl === null || avatarUrl === '') {
      const previousKey = user.avatarKey;
      user.avatarUrl = null;
      user.avatarKey = null;
      if (previousKey) {
        await this.storage.delete(previousKey).catch(() => undefined);
      }
      return;
    }

    if (
      !LIBRARY_AVATAR_RE.test(avatarUrl) &&
      !LEGACY_CDN_AVATAR_RE.test(avatarUrl)
    ) {
      throw new TraceabilityRuleException(
        'Avatar must be a DiceBear library choice or an uploaded image',
      );
    }

    const previousKey = user.avatarKey;
    user.avatarUrl = avatarUrl;
    user.avatarKey = null;
    if (previousKey) {
      await this.storage.delete(previousKey).catch(() => undefined);
    }
  }

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

    user.passwordHash = await hash(dto.newPassword, BCRYPT_ROUNDS);
    user.mustChangePassword = false;
    user.passwordResetToken = null;
    user.passwordResetExpiresAt = null;
    await this.users.save(user);

    return { success: true };
  }

  private hashResetToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

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

  private mfaPolicyApplies(user: User): boolean {
    return (
      user.role === UserRole.SYSTEM_ADMIN ||
      user.organization?.type === OrganizationType.REGULATOR
    );
  }

  private describe(user: User): AuthResult['user'] {
    const mfaEnabled = !!user.mfaEnabled;
    const pendingStillValid =
      !!user.pendingEmail &&
      !!user.emailChangeExpiresAt &&
      user.emailChangeExpiresAt.getTime() > Date.now();
    return {
      id: user.id,
      email: user.email,
      pendingEmail: pendingStillValid ? user.pendingEmail : null,
      pendingEmailExpiresAt:
        pendingStillValid && user.emailChangeExpiresAt
          ? user.emailChangeExpiresAt.toISOString()
          : null,
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
      mfaEnabled,
      mustEnableMfa: this.mfaPolicyApplies(user) && !mfaEnabled,
      avatarUrl: user.avatarUrl ?? null,
      avatarUploaded: !!user.avatarKey,
      capabilities: capabilitiesFor(
        user.role,
        user.organization?.type,
        (user.extraCapabilities ?? []) as Capability[],
      ),
    };
  }
}

function guessImageType(key: string): string {
  const lower = key.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}

export function describeOrganization(organization: Organization) {
  return {
    id: organization.id,
    name: organization.name,
    type: organization.type,
  };
}
