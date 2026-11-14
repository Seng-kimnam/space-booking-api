import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { DataSource } from 'typeorm';
import { OtpPurpose } from '../common/enums';
import type { LinkCodesPort } from '../telegram/telegram.ports';
import { UserOtp } from './entities/user-otp.entity';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/**
 * Telegram link codes in user_otps (TELEGRAM_LINK_CODES port): hash only,
 * single use, one live code per user and purpose (user_otps_live_uk).
 * Email OTPs (verify, password reset) are still issued by AuthService.
 */
@Injectable()
export class OtpService implements LinkCodesPort {
  constructor(private readonly dataSource: DataSource) {}

  async issue(
    userId: string,
    purpose: OtpPurpose.TELEGRAM_LINK,
    ttlMinutes: number,
  ): Promise<{ code: string; expiresAt: Date }> {
    const code = randomBytes(24).toString('base64url'); // 32 chars, t.me-safe
    const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);
    await this.dataSource.transaction(async (m) => {
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
  }

  async consume(code: string, purpose: OtpPurpose.TELEGRAM_LINK): Promise<string | null> {
    // Atomic: a concurrent second consume finds used_at set and gets nothing.
    // Query builder, not ds.query(): for UPDATE ... RETURNING, ds.query() on
    // Postgres returns [rows, affectedCount], not rows. `.raw` is always rows.
    const result = await this.dataSource
      .createQueryBuilder()
      .update(UserOtp)
      .set({ usedAt: () => 'now()' })
      .where('code_hash = :hash AND purpose = :purpose', { hash: sha256(code), purpose })
      .andWhere('used_at IS NULL AND expires_at > now()')
      .returning('user_id')
      .execute();
    const rows = result.raw as { user_id: string }[];
    return rows[0]?.user_id ?? null;
  }
}
