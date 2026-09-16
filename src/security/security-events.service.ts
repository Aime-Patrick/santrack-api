import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type SecurityEventName =
  | 'auth.login_failed'
  | 'auth.login_succeeded'
  | 'auth.mfa_challenge'
  | 'auth.mfa_failed'
  | 'auth.mfa_enabled'
  | 'auth.mfa_disabled'
  | 'auth.rate_limited';

export interface SecurityEventPayload {
  event: SecurityEventName;
  [key: string]: unknown;
}

/**
 * Structured security logging with an optional webhook for ops alerts.
 *
 * Set SECURITY_ALERT_WEBHOOK_URL to a Slack/Teams/incoming-webhook URL to
 * receive high-signal events (failed login, MFA failure). Success events stay
 * in application logs only.
 */
@Injectable()
export class SecurityEventsService {
  private readonly logger = new Logger(SecurityEventsService.name);
  private readonly webhookUrl: string | undefined;
  private readonly alertEvents: Set<string>;

  constructor(config: ConfigService) {
    this.webhookUrl = config.get<string>('security.alertWebhookUrl')?.trim() || undefined;
    this.alertEvents = new Set(
      (config.get<string>('security.alertEvents') ??
        'auth.login_failed,auth.mfa_failed')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }

  emit(payload: SecurityEventPayload): void {
    this.logger.log(JSON.stringify(payload));
    if (!this.webhookUrl || !this.alertEvents.has(payload.event)) {
      return;
    }
    void this.postWebhook(payload).catch((error: Error) => {
      this.logger.warn(`Security alert webhook failed: ${error.message}`);
    });
  }

  private async postWebhook(payload: SecurityEventPayload): Promise<void> {
    const body = {
      text: `[SanTrack] ${payload.event}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${payload.event}*\n\`\`\`${JSON.stringify(payload, null, 2)}\`\`\``,
          },
        },
      ],
    };
    const response = await fetch(this.webhookUrl!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
  }
}
