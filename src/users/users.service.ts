import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import type { NoShowCounterPort } from '../bookings/bookings.ports';
import {
  ListUsersQueryDto,
  MyProfileResponseDto,
  toMyProfile,
  toUserResponse,
  UpdateMyProfileDto,
  UserPageResponseDto,
  UserResponseDto,
} from './dto/user.dto';
import { User } from './entities/user.entity';

/** Escapes LIKE wildcards so `q` is matched literally. */
const escapeLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Account reads for admins, the caller's own profile, and the no-show counter
 * (NO_SHOW_COUNTER port, bookings expire job). Registration, login, OTP email
 * flows and suspension stay in the auth module.
 */
@Injectable()
export class UsersService implements NoShowCounterPort {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  async list(query: ListUsersQueryDto): Promise<UserPageResponseDto> {
    const qb = this.users
      .createQueryBuilder('u')
      .innerJoinAndSelect('u.role', 'r')
      .orderBy('u.created_at', 'DESC')
      .addOrderBy('u.id', 'ASC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit);
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

  async get(id: string): Promise<UserResponseDto> {
    return toUserResponse(await this.find(id));
  }

  async updateMyProfile(userId: string, dto: UpdateMyProfileDto): Promise<MyProfileResponseDto> {
    const user = await this.find(userId);
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
    return toMyProfile(saved);
  }

  /** users.no_show_count + 1, on the caller's transaction (NoShowCounterPort). */
  async incrementNoShow(manager: EntityManager, userId: string): Promise<void> {
    // Single atomic UPDATE: no read-modify-write race with a parallel expiry.
    await manager.query('UPDATE users SET no_show_count = no_show_count + 1 WHERE id = $1', [
      userId,
    ]);
  }

  private async find(id: string): Promise<User> {
    const user = await this.users.findOneBy({ id });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }
}
