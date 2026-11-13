import { OtpPurpose } from '../common/enums';

/**
 * Dependencies the telegram module needs from other modules, injected by token
 * so services are unit-testable with fakes. Bindings:
 *   TELEGRAM_LINK_CODES -> OtpService   (telegram.module.ts, from UsersModule)
 *   INBOX               -> InboxService (global MessagingModule)
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
   * Inserts (source, messageId) into inbox_events and runs `handler` only if
   * the row is new, in one transaction: if the handler throws, the row is
   * rolled back too, so a retry is processed again. Returns false for a
   * duplicate (already handled). Bound to messaging's InboxService.
   */
  handleOnce(
    message: InboxMessage,
    handler: () => Promise<void>,
  ): Promise<boolean>;
}
