import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import type { NoShowCounterPort } from '../../bookings/bookings.ports';
import {
  ActivityPageResponseDto,
  BookingSummaryDto,
  ListUsersQueryDto,
  MyProfileResponseDto,
  NotificationPageResponseDto,
  toActivity,
  toBookingSummary,
  toLinkedAccounts,
  toMyProfile,
  toNotification,
  toUserResponse,
  UpdateMyProfileDto,
  UserDetailResponseDto,
  UserPageResponseDto,
  UserStatsResponseDto,
} from '../dto/user.dto';
import { User } from '../entities/user.entity';
import {
  LINKED_ACCOUNTS,
  USER_BOOKINGS,
  USER_NOTIFICATIONS,
} from '../users.ports';
import type {
  LinkedAccountsPort,
  UserBookingsPort,
  UserNotificationsPort,
} from '../users.ports';

/** Escapes LIKE wildcards so `q` is matched literally. */
const escapeLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

function bound<T>(port: T | undefined, name: string): T {
  if (!port) throw new InternalServerErrorException(`${name} is not bound`);
  return port;
}

/** Profile and admin reads, profile edits, and the NO_SHOW_COUNTER port. */
@Injectable()
export class UsersService implements NoShowCounterPort {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @Optional() @Inject(USER_BOOKINGS) private readonly bookings?: UserBookingsPort,
    @Optional() @Inject(USER_NOTIFICATIONS) private readonly notifications?: UserNotificationsPort,
    @Optional() @Inject(LINKED_ACCOUNTS) private readonly links?: LinkedAccountsPort,
  ) {}

  async getMe(userId: string): Promise<MyProfileResponseDto> {
    return this.profile(await this.findOpen(userId));
  }

  async updateMyProfile(userId: string, dto: UpdateMyProfileDto): Promise<MyProfileResponseDto> {
    const user = await this.findOpen(userId);
    const changed: string[] = [];
    if (dto.name !== undefined) {
      user.name = dto.name;
      changed.push('name');
    }
    if (dto.avatarUrl !== undefined) {
      user.avatarUrl = dto.avatarUrl;
      changed.push('avatarUrl');
    }
    const saved = changed.length ? await this.users.save(user) : user;
    this.logger.log(`Profile updated: user=${userId} fields=${changed.join(',') || 'none'}`);
    return this.profile(saved);
  }

  /** Profile for an already-loaded user. */
  async profile(user: User): Promise<MyProfileResponseDto> {
    const linked = await bound(this.links, 'LINKED_ACCOUNTS').forUser(user.id);
    return toMyProfile(user, linked);
  }

  async summary(userId: string): Promise<BookingSummaryDto> {
    await this.findOpen(userId);
    return toBookingSummary(await bound(this.bookings, 'USER_BOOKINGS').summary(userId));
  }

  async notificationsOf(
    userId: string,
    page: number,
    limit: number,
    adminView: boolean,
  ): Promise<NotificationPageResponseDto> {
    await (adminView ? this.find(userId) : this.findOpen(userId));
    const res = await bound(this.notifications, 'USER_NOTIFICATIONS').list(
      userId,
      page,
      limit,
      adminView,
    );
    return { items: res.items.map(toNotification), page, limit, total: res.total };
  }

  async activityOf(
    userId: string,
    page: number,
    limit: number,
    adminView: boolean,
  ): Promise<ActivityPageResponseDto> {
    await (adminView ? this.find(userId) : this.findOpen(userId));
    const res = await bound(this.bookings, 'USER_BOOKINGS').activity(userId, page, limit);
    return { items: res.items.map(toActivity), page, limit, total: res.total };
  }

  async list(query: ListUsersQueryDto): Promise<UserPageResponseDto> {
    const qb = this.users
      .createQueryBuilder('u')
      .innerJoinAndSelect('u.role', 'r')
      .orderBy('u.created_at', 'DESC')
      .addOrderBy('u.id', 'ASC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit);
    qb.andWhere(query.deleted ? 'u.deleted_at IS NOT NULL' : 'u.deleted_at IS NULL');
    if (query.role) qb.andWhere('r.name = :role', { role: query.role });
    if (query.isActive !== undefined) qb.andWhere('u.is_active = :active', { active: query.isActive });
    if (query.adminRequestStatus) {
      qb.andWhere('u.admin_request_status = :ars', { ars: query.adminRequestStatus });
    }
    if (query.q) {
      qb.andWhere("(u.name ILIKE :q ESCAPE '\\' OR u.email ILIKE :q ESCAPE '\\')", {
        q: `%${escapeLike(query.q)}%`,
      });
    }
    const [rows, total] = await qb.getManyAndCount();
    return { items: rows.map(toUserResponse), page: query.page, limit: query.limit, total };
  }

  /** Account plus sign-in methods, links and booking stats. */
  async getDetail(id: string): Promise<UserDetailResponseDto> {
    const user = await this.find(id);
    const [linked, summary] = await Promise.all([
      bound(this.links, 'LINKED_ACCOUNTS').forUser(id),
      bound(this.bookings, 'USER_BOOKINGS').summary(id),
    ]);
    return {
      ...toUserResponse(user),
      hasPassword: !!user.passwordHash,
      googleLinked: !!user.googleId,
      linkedAccounts: toLinkedAccounts(linked),
      bookings: toBookingSummary(summary),
    };
  }

  async stats(): Promise<UserStatsResponseDto> {
    const [counts] = await this.users.query(
      `SELECT count(*) FILTER (WHERE deleted_at IS NULL)::int AS total,
              count(*) FILTER (WHERE deleted_at IS NULL AND is_active)::int AS active,
              count(*) FILTER (WHERE deleted_at IS NULL AND NOT is_active)::int AS suspended,
              count(*) FILTER (WHERE deleted_at IS NULL AND email_verified_at IS NULL)::int AS unverified,
              count(*) FILTER (WHERE deleted_at IS NOT NULL)::int AS deleted,
              count(*) FILTER (WHERE deleted_at IS NULL AND admin_request_status = 'PENDING'
                                 AND email_verified_at IS NOT NULL)::int AS "pendingAdminRequests",
              count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS "newLast7Days",
              count(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS "newLast30Days"
         FROM users`,
    );
    const byRole: { role: string; count: number }[] = await this.users.query(
      `SELECT r.name AS role, count(u.id)::int AS count
         FROM roles r LEFT JOIN users u ON u.role_id = r.id AND u.deleted_at IS NULL
        GROUP BY r.name ORDER BY r.name`,
    );
    const topNoShows: { id: string; name: string; noShowCount: number }[] = await this.users.query(
      `SELECT id, name, no_show_count AS "noShowCount" FROM users
        WHERE deleted_at IS NULL AND no_show_count > 0
        ORDER BY no_show_count DESC, name ASC LIMIT 5`,
    );
    return { ...counts, byRole, topNoShows };
  }

  /** NoShowCounterPort: runs on the caller's transaction. */
  async incrementNoShow(manager: EntityManager, userId: string): Promise<void> {
    // Atomic UPDATE: no race with a parallel expiry.
    await manager.query('UPDATE users SET no_show_count = no_show_count + 1 WHERE id = $1', [
      userId,
    ]);
  }

  /** Includes closed accounts. */
  private async find(id: string): Promise<User> {
    const user = await this.users.findOneBy({ id });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  /** Open accounts only. */
  private async findOpen(id: string): Promise<User> {
    const user = await this.find(id);
    if (user.deletedAt) throw new NotFoundException('User not found');
    return user;
  }
}
