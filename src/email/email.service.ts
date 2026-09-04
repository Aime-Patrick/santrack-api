import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SendEmailOptions } from './providers/email-provider.interface';
import { EmailProviderFactory } from './email-provider.factory';
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
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    @InjectQueue('email') private readonly emailQueue: Queue,
    private readonly providerFactory: EmailProviderFactory,
  ) {}

  async send(options: SendEmailOptions): Promise<void> {
    try {
      await this.emailQueue.add('send-email', options, {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: true,
        removeOnFail: false,
      });
      this.logger.log(`Enqueued email job for ${options.to}: ${options.subject}`);
    } catch (error) {
      this.logger.warn(`Failed to enqueue email to Redis queue, falling back to direct send: ${(error as Error).message}`);
      try {
        const provider = this.providerFactory.getProvider();
        await provider.send(options);
        this.logger.log(`Directly delivered email to ${options.to}: ${options.subject}`);
      } catch (sendErr) {
        this.logger.error(`Failed direct email delivery to ${options.to}:`, sendErr);
        throw sendErr;
      }
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

  // ── Registration lifecycle emails ──

  async sendRegistrationSubmitted(params: {
    to: string;
    companyName: string;
  }): Promise<void> {
    await this.send({
      to: params.to,
      subject: 'Registration received — SANTRACK',
      template: 'registration-submitted',
      data: {
        title: 'Registration received',
        companyName: params.companyName,
      },
    });
  }

  async sendRegistrationApproved(params: {
    to: string;
    companyName: string;
    loginUrl: string;
  }): Promise<void> {
    await this.send({
      to: params.to,
      subject: 'Registration approved — SANTRACK',
      template: 'registration-approved',
      data: {
        title: 'Registration approved',
        companyName: params.companyName,
        loginUrl: params.loginUrl,
      },
    });
  }

  async sendRegistrationRejected(params: {
    to: string;
    companyName: string;
    reason: string;
  }): Promise<void> {
    await this.send({
      to: params.to,
      subject: 'Registration requires attention — SANTRACK',
      template: 'registration-rejected',
      data: {
        title: 'Registration requires attention',
        companyName: params.companyName,
        reason: params.reason,
      },
    });
  }
}
