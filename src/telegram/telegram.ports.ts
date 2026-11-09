import { OtpPurpose } from '../common/enums';

/**
 * Dependencies the telegram module needs from modules owned by teammates.
 * They are injected by token so this module compiles and is unit-testable before
 * those modules exist. Wiring, once they merge (telegram.module.ts):
 *   imports:   [UsersModule, MessagingModule]
 *   providers: { provide: TELEGRAM_LINK_CODES, useExisting: OtpService },
 *              { provide: INBOX, useExisting: InboxService }
 */

/** users module, OtpService (user_otps, purpose TELEGRAM_LINK). */
export const TELEGRAM_LINK_CODES = Symbol('TELEGRAM_LINK_CODES');
export interface LinkCodesPort {
  /**
   * Creates a single-use code (hash stored, previous live code replaced).
   * The code goes in a t.me deep link, so it must match [A-Za-z0-9_-]{1,64}.
   */
  issue(
    userId: string,
    purpose: OtpPurpose.TELEGRAM_LINK,
    ttlMinutes: number,
  ): Promise<{ code: string; expiresAt: Date }>;

  /** Marks the code used and returns its user id, or null if unknown/expired/used. */
  consume(
    code: string,
    purpose: OtpPurpose.TELEGRAM_LINK,
  ): Promise<string | null>;
}

/** messaging module, InboxService (inbox_events). */
export const INBOX = Symbol('INBOX');
export interface InboxMessage {
  source: string;
  messageId: string;
  eventType: string;
  /** Stored in inbox_events. Must not contain codes or tokens. */
  payload: Record<string, unknown>;
}
export interface InboxPort {
  /**
   * Inserts (source, messageId) into inbox_events first; runs `handler` only if
   * the row is new. Returns false for a duplicate (already handled).
   */
  handleOnce(
    message: InboxMessage,
    handler: () => Promise<void>,
  ): Promise<boolean>;
}
