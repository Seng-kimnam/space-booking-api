import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { telegramConfig } from '../configuration/telegram.config';

const REQUEST_TIMEOUT_MS = 10_000;

export class TelegramApiError extends Error {
  constructor(
    readonly errorCode: number,
    description: string,
  ) {
    super(`Telegram API error ${errorCode}: ${description}`);
  }

  /** 403: the user blocked the bot or deleted the chat. Retrying won't help. */
  get isRecipientGone(): boolean {
    return this.errorCode === 403;
  }
}

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
}

/**
 * Thin client over the Telegram Bot API using plain fetch (no extra package).
 * The bot token is part of the URL, so URLs and raw fetch errors are never logged
 * or put in error messages.
 */
@Injectable()
export class TelegramBotClient {
  constructor(
    @Inject(telegramConfig.KEY)
    private readonly config: ConfigType<typeof telegramConfig>,
  ) {}

  get isConfigured(): boolean {
    return this.config.botToken !== '';
  }

  /** `text` is Telegram HTML; callers escape user-provided parts. */
  async sendMessage(chatId: string, text: string): Promise<void> {
    await this.call('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
  }

  async setWebhook(
    url: string,
    secretToken: string,
    allowedUpdates: string[],
  ): Promise<void> {
    await this.call('setWebhook', {
      url,
      secret_token: secretToken,
      allowed_updates: allowedUpdates,
      drop_pending_updates: false,
    });
  }

  private async call<T>(
    method: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    if (!this.isConfigured) {
      throw new Error('TELEGRAM_BOT_TOKEN is not set');
    }

    let response: Response;
    try {
      response = await fetch(
        `${this.config.apiBaseUrl}/bot${this.config.botToken}/${method}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );
    } catch {
      // The original error can carry the request URL, which contains the token.
      throw new Error(`Telegram ${method} request failed (network or timeout)`);
    }

    const data = (await response.json()) as TelegramResponse<T>;
    if (!data.ok) {
      throw new TelegramApiError(
        data.error_code ?? response.status,
        data.description ?? 'unknown error',
      );
    }
    return data.result as T;
  }
}
