import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { telegramConfig } from '../configuration/telegram.config';
import { TelegramBotClient } from './telegram-bot.client';

/**
 * Registers our webhook with Telegram at startup when TELEGRAM_WEBHOOK_URL is set.
 * Locally, point it at a tunnel (ngrok / cloudflared) to /api/v1/webhooks/telegram.
 */
@Injectable()
export class TelegramWebhookRegistrar implements OnApplicationBootstrap {
  private readonly logger = new Logger(TelegramWebhookRegistrar.name);

  constructor(
    private readonly bot: TelegramBotClient,
    @Inject(telegramConfig.KEY)
    private readonly config: ConfigType<typeof telegramConfig>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.webhookUrl || !this.bot.isConfigured) {
      this.logger.log(
        'Telegram webhook not registered (bot token or URL not set)',
      );
      return;
    }
    if (!this.config.webhookSecret) {
      this.logger.warn(
        'TELEGRAM_WEBHOOK_SECRET is empty; webhook not registered',
      );
      return;
    }
    try {
      await this.bot.setWebhook(
        this.config.webhookUrl,
        this.config.webhookSecret,
        ['message', 'my_chat_member'],
      );
      this.logger.log('Telegram webhook registered');
    } catch (err) {
      // Don't block startup: alerts are queued in `notifications` and retried.
      this.logger.warn(
        `Telegram setWebhook failed: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
    }
  }
}
