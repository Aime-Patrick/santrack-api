import * as nodemailer from 'nodemailer';
import { EmailProvider, SendEmailOptions } from './email-provider.interface';
import { EmailTemplateEngine } from '../email-template.engine';

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

export class SmtpProvider implements EmailProvider {
  private transporter: nodemailer.Transporter;
  private from: string;
  private templateEngine: EmailTemplateEngine;

  constructor(config: SmtpConfig) {
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: config.user ? { user: config.user, pass: config.pass } : undefined,
    });
    this.from = config.from;
    this.templateEngine = new EmailTemplateEngine();
  }

  async send(options: SendEmailOptions): Promise<void> {
    const html = this.templateEngine.render(options.template, options.data);
    await this.transporter.sendMail({
      from: this.from,
      to: options.to,
      subject: options.subject,
      html,
    });
  }
}
