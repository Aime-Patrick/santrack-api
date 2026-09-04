import * as path from 'path';
import * as fs from 'fs';
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
    // If using Gmail SMTP, the 'from' must match the authenticated account to avoid rejection/spam flagging
    if (config.host.includes('gmail.com') && config.user) {
      this.from = `"SANTRACK" <${config.user}>`;
    } else {
      this.from = config.from || config.user;
    }
    this.templateEngine = new EmailTemplateEngine();
  }

  async send(options: SendEmailOptions): Promise<void> {
    const html = this.templateEngine.render(options.template, options.data);

    // Resolve logo asset for inline CID embedding across both dev and prod dist paths
    const possibleLogoPaths = [
      path.join(__dirname, '..', 'assets', 'logo-symbol.png'),
      path.join(__dirname, '..', '..', '..', 'src', 'email', 'assets', 'logo-symbol.png'),
      path.join(process.cwd(), 'src', 'email', 'assets', 'logo-symbol.png'),
      path.join(process.cwd(), 'dist', 'email', 'assets', 'logo-symbol.png'),
    ];
    const logoPath = possibleLogoPaths.find((p) => fs.existsSync(p));

    const attachments: nodemailer.SendMailOptions['attachments'] = logoPath
      ? [
          {
            filename: 'logo-symbol.png',
            path: logoPath,
            cid: 'santrack-logo-symbol',
          },
        ]
      : [];

    await this.transporter.sendMail({
      from: this.from,
      to: options.to,
      subject: options.subject,
      html,
      attachments,
    });
  }
}
