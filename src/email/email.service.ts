import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailProvider, SendEmailOptions } from './providers/email-provider.interface';
import { SmtpProvider } from './providers/smtp.provider';
import { UserRole } from '../auth/user-role.enum';

const ROLE_LABELS: Record<UserRole, string> = {
  [UserRole.SYSTEM_ADMIN]: 'System Admin',
  [UserRole.ORG_ADMIN]: 'Org Admin',
  [UserRole.PRODUCTION_MANAGER]: 'Production Manager',
  [UserRole.PRODUCTION_OFFICER]: 'Production Officer',
  [UserRole.WAREHOUSE_MANAGER]: 'Warehouse Manager',
  [UserRole.WAREHOUSE_OFFICER]: 'Warehouse Officer',
  [UserRole.QUALITY_OFFICER]: 'Quality Officer',
  [UserRole.LOGISTICS_OFFICER]: 'Logistics Officer',
  [UserRole.SALES_OFFICER]: 'Sales Officer',
  [UserRole.MANAGEMENT]: 'Management',
  [UserRole.AUDITOR]: 'Auditor',
};

@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);
  private provider!: EmailProvider;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const providerType = this.config.get<string>('email.provider') ?? 'smtp';

    if (providerType === 'smtp') {
      this.provider = new SmtpProvider({
        host: this.config.getOrThrow<string>('email.smtpHost'),
        port: this.config.getOrThrow<number>('email.smtpPort'),
        user: this.config.get<string>('email.smtpUser') ?? '',
        pass: this.config.get<string>('email.smtpPass') ?? '',
        from: this.config.getOrThrow<string>('email.from'),
      });
      this.logger.log('Email provider: SMTP');
    } else {
      throw new Error(`Unknown email provider: ${providerType}`);
    }
  }

  async send(options: SendEmailOptions): Promise<void> {
    try {
      await this.provider.send(options);
      this.logger.log(`Email sent to ${options.to}: ${options.subject}`);
    } catch (error) {
      this.logger.error(`Failed to send email to ${options.to}:`, error);
      throw error;
    }
  }

  async sendVerificationEmail(to: string, token: string, baseUrl: string): Promise<void> {
    const verificationUrl = `${baseUrl}/verify-email?token=${token}`;
    await this.send({
      to,
      subject: 'Verify your email — SANTRACK',
      template: 'verify-email',
      data: {
        title: 'Verify your email',
        verificationUrl,
        expiresIn: '24 hours',
      },
    });
  }

  async sendResetPasswordEmail(to: string, token: string, baseUrl: string): Promise<void> {
    const resetUrl = `${baseUrl}/reset-password?token=${token}`;
    await this.send({
      to,
      subject: 'Reset your password — SANTRACK',
      template: 'reset-password',
      data: {
        title: 'Reset your password',
        resetUrl,
        expiresIn: '1 hour',
      },
    });
  }

  async sendForgotPasswordEmail(to: string, token: string, baseUrl: string): Promise<void> {
    const resetUrl = `${baseUrl}/reset-password?token=${token}`;
    await this.send({
      to,
      subject: 'Forgot your password? — SANTRACK',
      template: 'forgot-password',
      data: {
        title: 'Forgot your password?',
        resetUrl,
        expiresIn: '1 hour',
      },
    });
  }

  async sendWelcomeEmail(to: string, name: string, baseUrl: string): Promise<void> {
    const dashboardUrl = `${baseUrl}/dashboard`;
    await this.send({
      to,
      subject: 'Welcome to SANTRACK',
      template: 'welcome',
      data: {
        title: 'Welcome to SANTRACK',
        name,
        dashboardUrl,
      },
    });
  }

  async sendInviteEmail(input: {
    to: string;
    name: string;
    organizationName: string;
    role: UserRole;
    temporaryPassword: string;
    inviterName: string;
    loginUrl: string;
  }): Promise<void> {
    await this.send({
      to: input.to,
      subject: `You've been added to ${input.organizationName} — SANTRACK`,
      template: 'invite',
      data: {
        title: 'Team invite',
        name: input.name,
        email: input.to,
        organizationName: input.organizationName,
        roleLabel: ROLE_LABELS[input.role] ?? input.role,
        temporaryPassword: input.temporaryPassword,
        inviterName: input.inviterName,
        loginUrl: input.loginUrl,
      },
    });
  }

  async sendAdminPasswordResetEmail(input: {
    to: string;
    name: string;
    organizationName: string | null;
    temporaryPassword: string;
    resetBy: string;
    loginUrl: string;
  }): Promise<void> {
    await this.send({
      to: input.to,
      subject: 'Your SANTRACK password was reset',
      template: 'password-reset-by-admin',
      data: {
        title: 'Password reset',
        name: input.name,
        email: input.to,
        organizationName: input.organizationName,
        temporaryPassword: input.temporaryPassword,
        resetBy: input.resetBy,
        loginUrl: input.loginUrl,
      },
    });
  }
}
