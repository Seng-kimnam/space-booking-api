import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { User, UserRole } from '../users/entities/user.entity';
import { AuthService } from './auth.service';

/**
 * Suspends and reactivates accounts (docs/auth.md M3). A suspended account
 * can't log in or refresh, and suspension revokes its refresh tokens, so it
 * loses access within one access-token lifetime (15 min by default).
 *
 * Who may act on whom, decided from roles read from the database (not from
 * the JWT, which may be up to one token lifetime stale):
 * - ADMIN: USER accounts only.
 * - SUPER_ADMIN: USER and ADMIN accounts.
 * - Nobody: a SUPER_ADMIN, or their own account.
 */
@Injectable()
export class AccountStatusService {
  private readonly logger = new Logger(AccountStatusService.name);

  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly authService: AuthService,
    private readonly dataSource: DataSource,
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

  private async authorize(
    actorId: string,
    userId: string,
    action: 'suspend' | 'reactivate',
  ): Promise<User> {
    const [actor, target] = await Promise.all([
      this.usersRepository.findOneBy({ id: actorId }),
      this.usersRepository.findOneBy({ id: userId }),
    ]);
    if (!target) throw new NotFoundException('User not found');

    const actorRole = actor?.role.name as UserRole | undefined;
    const targetRole = target.role.name as UserRole;
    const allowed =
      !!actor &&
      actor.isActive &&
      actor.id !== target.id &&
      targetRole !== UserRole.SUPER_ADMIN &&
      (actorRole === UserRole.SUPER_ADMIN ||
        (actorRole === UserRole.ADMIN && targetRole === UserRole.USER));
    if (!allowed) {
      this.logger.warn(
        `Account ${action} refused: user=${target.id} by=${actorId} ` +
          `actorRole=${actorRole ?? 'none'} targetRole=${targetRole}`,
      );
      throw new ForbiddenException(`You cannot ${action} this account`);
    }
    return target;
  }
}
