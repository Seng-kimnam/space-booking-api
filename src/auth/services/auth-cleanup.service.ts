import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RefreshToken } from '../entities/refresh-token.entity';
import { UserOtp } from '../../users/entities/user-otp.entity';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Deletes auth rows that can never be used again (run by AuthCleanupJob).
 * Rows are kept one extra day after expiry for troubleshooting. Revoked but
 * unexpired refresh tokens are kept on purpose: refresh-token reuse detection
 * needs them for the token's whole lifetime.
 */
@Injectable()
export class AuthCleanupService {
  constructor(
    @InjectRepository(UserOtp)
    private readonly otps: Repository<UserOtp>,
    @InjectRepository(RefreshToken)
    private readonly refreshTokens: Repository<RefreshToken>,
  ) {}

  /** Returns how many rows were deleted (OTPs + refresh tokens). */
  async purgeExpired(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - DAY_MS);
    const [otps, tokens] = await Promise.all([
      this.otps
        .createQueryBuilder()
        .delete()
        .where('expires_at < :cutoff', { cutoff })
        .execute(),
      this.refreshTokens
        .createQueryBuilder()
        .delete()
        .where('expires_at < :cutoff', { cutoff })
        .execute(),
    ]);
    return (otps.affected ?? 0) + (tokens.affected ?? 0);
  }
}
