import { NotificationChannel } from '../../common/enums';

/** Channel-neutral message; each strategy formats it for its provider. */
export interface RenderedNotification {
  title: string;
  body: string;
}

/**
 * Strategy pattern: one implementation per delivery provider (Telegram today;
 * email, SMS, push later). The dispatcher picks the strategy by
 * `notifications.channel` and knows nothing about any provider.
 *
 * Adding a provider:
 *   1. a migration adding the value to the `notification_channel` enum (and to
 *      `notifications_channel_type_chk` if it carries booking alerts),
 *   2. the value in common/enums/notification-channel.enum.ts,
 *   3. a class implementing this interface, added to NOTIFICATION_CHANNEL_STRATEGIES
 *      in notifications.module.ts.
 */
export interface NotificationChannelStrategy {
  readonly channel: NotificationChannel;

  /**
   * Delivers the message. Throw RecipientUnreachableError when retrying can't
   * help, including when the user has no destination on this channel (e.g. no
   * linked chat): the row becomes SKIPPED. Throw RateLimitedError when the
   * provider asks to slow down. Any other error is retried with backoff.
   */
  send(userId: string, message: RenderedNotification): Promise<void>;
}

export class RecipientUnreachableError extends Error {}

/** The provider asked us to wait (Telegram 429 `retry_after`). */
export class RateLimitedError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs: number,
  ) {
    super(message);
  }
}

/** Multi-provider token: the array of every registered strategy. */
export const NOTIFICATION_CHANNEL_STRATEGIES = Symbol(
  'NOTIFICATION_CHANNEL_STRATEGIES',
);
