import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThan, Repository } from 'typeorm';
import { RefreshToken } from './entities/refresh-token.entity';

/** A live sign-in (one refresh-token chain). Never includes the token or its hash. */
export interface SessionInfo {
  id: string;
  userAgent: string | null;
  ip: string | null;
  /** When this token was issued (last sign-in or refresh on that device). */
  lastActiveAt: Date;
  expiresAt: Date;
}

/**
 * Lists and revokes a user's live refresh tokens (sessions). A session's id is
 * the refresh token's id, also carried as `sid` in its access tokens.
 * Revoking all sessions stays in AuthService.revokeAllSessions.
 */
@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    @InjectRepository(RefreshToken)
    private readonly tokens: Repository<RefreshToken>,
  ) {}

  async list(userId: string): Promise<SessionInfo[]> {
    const rows = await this.tokens.find({
      where: { userId, revokedAt: IsNull(), expiresAt: MoreThan(new Date()) },
      order: { createdAt: 'DESC' },
    });
    return rows.map((t) => ({
      id: t.id,
      userAgent: t.userAgent,
      ip: t.ip,
      lastActiveAt: t.createdAt,
      expiresAt: t.expiresAt,
    }));
  }

  /** 404 unless it is a live session of this user. */
  async revoke(userId: string, sessionId: string): Promise<void> {
    const result = await this.tokens.update(
      { id: sessionId, userId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
    if (!result.affected) throw new NotFoundException('Session not found');
    this.logger.log(`Session revoked: user=${userId} session=${sessionId}`);
  }
}
