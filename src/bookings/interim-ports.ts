import { createHash, randomBytes } from 'node:crypto';
import { DataSource } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm';
import type { NoShowCounterPort, OutboxPort } from './bookings.ports';
import { OutboxEvent } from '../messaging/entities/outbox-event.entity';
import { UserOtp } from '../users/entities/user-otp.entity';
import type { InboxPort, LinkCodesPort } from '../telegram/telegram.ports';

/**
 * INTERIM stand-ins for ports whose owning modules haven't merged yet
 * (users, messaging, OTP). Delete each one when its real provider lands
 * and bind the token with `useExisting` instead (see bookings.ports.ts /
 * telegram.ports.ts). Seats and places are already real (SeatsService, PlacesService).
 */

export const interimNoShowCounter: NoShowCounterPort = {
  async incrementNoShow(manager, userId) {
    await manager.query('UPDATE users SET no_show_count = no_show_count + 1 WHERE id = $1', [
      userId,
    ]);
  },
};

export const interimOutbox: OutboxPort = {
  async add(manager, event) {
    // QueryDeepPartialEntity can't express a free-form jsonb Record; the fields match the entity.
    await manager.getRepository(OutboxEvent).insert(event as QueryDeepPartialEntity<OutboxEvent>);
  },
};

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** Telegram link codes in user_otps: hash only, single use, one live code per user. */
export function interimLinkCodes(ds: DataSource): LinkCodesPort {
  return {
    async issue(userId, purpose, ttlMinutes) {
      const code = randomBytes(24).toString('base64url'); // 32 chars, t.me-safe
      const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);
      await ds.transaction(async (m) => {
        // Retire the previous live code (partial unique index user_otps_live_uk).
        await m.query(
          `UPDATE user_otps SET used_at = now()
            WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL`,
          [userId, purpose],
        );
        await m.query(
          `INSERT INTO user_otps (user_id, purpose, code_hash, expires_at)
           VALUES ($1, $2, $3, $4)`,
          [userId, purpose, sha256(code), expiresAt],
        );
      });
      return { code, expiresAt };
    },

    async consume(code, purpose) {
      // Atomic: a concurrent second consume finds used_at set and gets nothing.
      // Query builder, not ds.query(): for UPDATE ... RETURNING, ds.query() on
      // Postgres returns [rows, affectedCount], not rows. `.raw` is always rows.
      const result = await ds
        .createQueryBuilder()
        .update(UserOtp)
        .set({ usedAt: () => 'now()' })
        .where('code_hash = :hash AND purpose = :purpose', { hash: sha256(code), purpose })
        .andWhere('used_at IS NULL AND expires_at > now()')
        .returning('user_id')
        .execute();
      const rows = result.raw as { user_id: string }[];
      return rows[0]?.user_id ?? null;
    },
  };
}

/** inbox_events: insert first, run the handler only for a new (source, message_id). */
export function interimInbox(ds: DataSource): InboxPort {
  return {
    async handleOnce(message, handler) {
      const inserted: { id: string }[] = await ds.query(
        `INSERT INTO inbox_events (source, message_id, event_type, payload)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (source, message_id) DO NOTHING
         RETURNING id`,
        [message.source, message.messageId, message.eventType, message.payload],
      );
      if (inserted.length === 0) return false;
      const id = inserted[0].id;
      try {
        await handler();
        await ds.query('UPDATE inbox_events SET processed_at = now() WHERE id = $1', [id]);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        await ds.query('UPDATE inbox_events SET error = $2 WHERE id = $1', [id, reason]);
        throw err;
      }
      return true;
    },
  };
}
