import { createHash, randomBytes } from 'node:crypto';
import { DataSource } from 'typeorm';
import type { NoShowCounterPort } from './bookings.ports';
import { UserOtp } from '../users/entities/user-otp.entity';
import type { LinkCodesPort } from '../telegram/telegram.ports';

/**
 * INTERIM stand-ins for ports whose owning modules haven't merged yet
 * (users, OTP). Delete each one when its real provider lands
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

