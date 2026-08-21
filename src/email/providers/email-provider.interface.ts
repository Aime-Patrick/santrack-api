export interface SendEmailOptions {
  to: string;
  subject: string;
  template: string;
  data: Record<string, unknown>;
}

export interface EmailProvider {
  send(options: SendEmailOptions): Promise<void>;
}
