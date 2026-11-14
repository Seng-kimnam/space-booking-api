import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuthService } from '../../auth/services/auth.service';
import { SessionInfo, SessionsService } from '../../auth/services/sessions.service';
import { canManage } from '../policies/account-policy';
import { User } from '../entities/user.entity';
import { USER_BOOKINGS } from '../users.ports';
import type { UserBookingsPort } from '../users.ports';

export type AccountAction =
  | 'suspend'
  | 'reactivate'
  | 'delete'
  | 'restore'
  | 'edit'
  | 'verify'
  | 'manage sessions of';

/**
 * Suspend/reactivate, close/restore, revoke sessions, verify email.
 * Revoking refresh tokens ends access within one access-token lifetime.
 */
@Injectable()
export class AccountStatusService {
  private readonly logger = new Logger(AccountStatusService.name);

  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly authService: AuthService,
    private readonly sessions: SessionsService,
    private readonly dataSource: DataSource,
    @Optional() @Inject(USER_BOOKINGS) private readonly bookings?: UserBookingsPort,
  ) {}

  async suspend(actorId: string, userId: string): Promise<void> {
    const target = await this.authorize(actorId, userId, 'suspend');
    if (!target.isActive) return; // already suspended: idempotent
    const revoked = await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(User).update(target.id, { isActive: false });
      return this.authService.revokeAllSessions(manager, target.id);
    });
    this.logger.log(
      `Account suspended: user=${target.id} by=${actorId} revokedSessions=${revoked}`,
    );
  }

  async reactivate(actorId: string, userId: string): Promise<void> {
    const target = await this.authorize(actorId, userId, 'reactivate');
    if (target.isActive) return;
    await this.usersRepository.update(target.id, { isActive: true });
    this.logger.log(`Account reactivated: user=${target.id} by=${actorId}`);
  }

  /** Owner closes their own account (password confirmed). */
  async closeOwn(userId: string, password: string | undefined): Promise<void> {
    const user = await this.usersRepository.findOneBy({ id: userId });
    if (!user || user.deletedAt) throw new NotFoundException('User not found');
    await this.authService.assertPassword(user, password);
    await this.close(user.id, userId);
  }

  /** Idempotent. */
  async closeByAdmin(actorId: string, userId: string): Promise<void> {
    const target = await this.authorize(actorId, userId, 'delete', true);
    if (target.deletedAt) return;
    await this.close(target.id, actorId);
  }

  /** Reopens a closed account; cancelled bookings stay cancelled. */
  async restore(actorId: string, userId: string): Promise<void> {
    const target = await this.authorize(actorId, userId, 'restore', true);
    if (!target.deletedAt) return;
    await this.usersRepository.update(target.id, { deletedAt: null });
    this.logger.log(`Account restored: user=${target.id} by=${actorId}`);
  }

  async listSessions(actorId: string, userId: string): Promise<SessionInfo[]> {
    const target = await this.authorize(actorId, userId, 'manage sessions of', true);
    return this.sessions.list(target.id);
  }

  /** Logs out every device without suspending. */
  async revokeSessions(actorId: string, userId: string): Promise<void> {
    const target = await this.authorize(actorId, userId, 'manage sessions of', true);
    const revoked = await this.authService.revokeAllSessions(
      this.dataSource.manager,
      target.id,
    );
    this.logger.log(`Sessions revoked: user=${target.id} by=${actorId} count=${revoked}`);
  }

  /** Idempotent. */
  async verifyEmail(actorId: string, userId: string): Promise<void> {
    const target = await this.authorize(actorId, userId, 'verify');
    if (target.emailVerifiedAt) return;
    await this.usersRepository.update(target.id, { emailVerifiedAt: new Date() });
    this.logger.log(`Email verified by admin: user=${target.id} by=${actorId}`);
  }

  /** Applies account-policy; a closed target is 409 unless `allowClosed`. */
  async authorize(
    actorId: string,
    userId: string,
    action: AccountAction,
    allowClosed = false,
  ): Promise<User> {
    const [actor, target] = await Promise.all([
      this.usersRepository.findOneBy({ id: actorId }),
      this.usersRepository.findOneBy({ id: userId }),
    ]);
    if (!target) throw new NotFoundException('User not found');
    if (!canManage(actor, target)) {
      this.logger.warn(
        `Account ${action} refused: user=${target.id} by=${actorId} ` +
          `actorRole=${actor?.role.name ?? 'none'} targetRole=${target.role.name}`,
      );
      throw new ForbiddenException(`You cannot ${action} this account`);
    }
    if (target.deletedAt && !allowClosed) {
      throw new ConflictException('Account is closed; restore it first');
    }
    return target;
  }

  /**
   * One transaction. The row lock is the one booking creation takes, so no
   * booking slips in between the cancel and the close.
   */
  private async close(userId: string, actorId: string): Promise<void> {
    const bookings = this.bookings;
    if (!bookings) throw new InternalServerErrorException('USER_BOOKINGS is not bound');
    const now = new Date();
    const { cancelled, revoked } = await this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [userId]);
      if (await bookings.hasSeatInUse(manager, userId)) {
        throw new ConflictException(
          'The account has a seat in use; check out before closing it',
        );
      }
      const cancelled = await bookings.cancelAllPending(manager, userId, actorId, now);
      await manager
        .getRepository(User)
        .update(userId, { deletedAt: now, pendingEmail: null });
      const revoked = await this.authService.revokeAllSessions(manager, userId);
      return { cancelled, revoked };
    });
    this.logger.log(
      `Account closed: user=${userId} by=${actorId} cancelledBookings=${cancelled} revokedSessions=${revoked}`,
    );
  }
}
