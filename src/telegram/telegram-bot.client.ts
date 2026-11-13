import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { telegramConfig } from '../configuration/telegram.config';

const REQUEST_TIMEOUT_MS = 10_000;

// 400 descriptions meaning the chat can never receive messages again.
const GONE_400 = /chat not found|user is deactivated|peer_id_invalid/i;

export class TelegramApiError extends Error {
  constructor(
    readonly errorCode: number,
    readonly description: string,
    /** 429 only: seconds Telegram asks us to wait (parameters.retry_after). */
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(`Telegram API error ${errorCode}: ${description}`);
  }

  get isRateLimited(): boolean {
    return this.errorCode === 429;
  }

  /**
   * Retrying won't help: 403 (the user blocked the bot or deleted the chat), or
   * a 400 saying the chat doesn't exist / the account was deleted. Callers
   * unlink the chat and skip the message instead of retrying 5 times.
   */
  get isRecipientGone(): boolean {
    return (
      this.errorCode === 403 ||
      (this.errorCode === 400 && GONE_400.test(this.description))
    );
  }
}

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
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

    let data: TelegramResponse<T>;
    try {
      data = (await response.json()) as TelegramResponse<T>;
    } catch {
      // e.g. an HTML 502 page from a proxy: keep it a TelegramApiError (retried
      // by the dispatcher) instead of an opaque SyntaxError.
      throw new TelegramApiError(
        response.status,
        `non-JSON response to ${method}`,
      );
    }
    if (!data.ok) {
      const retryAfter = data.parameters?.retry_after;
      throw new TelegramApiError(
        data.error_code ?? response.status,
        data.description ?? 'unknown error',
        typeof retryAfter === 'number' ? retryAfter : null,
      );
    }
    return data.result as T;
  }
}
