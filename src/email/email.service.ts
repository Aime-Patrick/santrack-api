import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailProvider, SendEmailOptions } from './providers/email-provider.interface';
import { SmtpProvider } from './providers/smtp.provider';

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
      subject: 'Verify Your Email - SANTRACK',
      template: 'verify-email',
      data: { verificationUrl, expiresIn: '24 hours' },
    });
  }

  async sendResetPasswordEmail(to: string, token: string, baseUrl: string): Promise<void> {
    const resetUrl = `${baseUrl}/reset-password?token=${token}`;
    await this.send({
      to,
      subject: 'Reset Your Password - SANTRACK',
      template: 'reset-password',
      data: { resetUrl, expiresIn: '1 hour' },
    });
  }

  async sendForgotPasswordEmail(to: string, token: string, baseUrl: string): Promise<void> {
    const resetUrl = `${baseUrl}/reset-password?token=${token}`;
    await this.send({
      to,
      subject: 'Forgot Your Password? - SANTRACK',
      template: 'forgot-password',
      data: { resetUrl, expiresIn: '1 hour' },
    });
  }

  async sendWelcomeEmail(to: string, name: string, baseUrl: string): Promise<void> {
    const dashboardUrl = `${baseUrl}/dashboard`;
    await this.send({
      to,
      subject: 'Welcome to SANTRACK!',
      template: 'welcome',
      data: { name, dashboardUrl },
    });
  }
}
