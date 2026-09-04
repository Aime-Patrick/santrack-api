import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailProvider } from './providers/email-provider.interface';
import { SmtpProvider } from './providers/smtp.provider';

@Injectable()
export class EmailProviderFactory implements OnModuleInit {
  private readonly logger = new Logger(EmailProviderFactory.name);
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
      this.logger.log('Initialized SMTP EmailProvider');
    } else {
      throw new Error(`Unknown email provider: ${providerType}`);
    }
  }

  getProvider(): EmailProvider {
    return this.provider;
  }
}
