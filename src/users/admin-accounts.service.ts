import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';
import { AuthService } from '../auth/auth.service';
import { UserRole } from '../common/enums';
import { isPgError, PG_UNIQUE_VIOLATION } from '../common/utils/db-errors';
import { Role } from '../roles/entities/role.entity';
import { isSuperAdmin } from './account-policy';
import { AccountStatusService } from './account-status.service';
import {
  AdminUpdateUserDto,
  AssignableRole,
  CreateUserDto,
  toUserResponse,
  UserResponseDto,
} from './dto/user.dto';
import { AdminRequestStatus, User } from './entities/user.entity';

/**
 * Admin account management that changes account data (docs/api-endpoints.md
 * 8i-8k): create, edit, change role. Status changes live in AccountStatusService.
 */
@Injectable()
export class AdminAccountsService {
  private readonly logger = new Logger(AdminAccountsService.name);

  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(Role)
    private readonly roles: Repository<Role>,
    private readonly status: AccountStatusService,
    private readonly authService: AuthService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Creates a verified account with an unusable random password, then mails a
   * PASSWORD_RESET code so the user sets their own (POST /auth/reset-password).
   * Admins never choose or see a user's password.
   */
  async create(actorId: string, dto: CreateUserDto): Promise<UserResponseDto> {
    const role = dto.role ?? UserRole.USER;
    const actor = await this.users.findOneBy({ id: actorId });
    if (role === UserRole.ADMIN && !isSuperAdmin(actor)) {
      throw new ForbiddenException('Only a SUPER_ADMIN can create ADMIN accounts');
    }
    const roleRow = await this.findRole(role);
    const now = new Date();
    let user: User;
    try {
      user = await this.users.save(
        this.users.create({
          name: dto.name,
          email: dto.email,
          // users_has_credential CHECK needs a credential; nobody knows this one.
          passwordHash: await bcrypt.hash(randomUUID() + randomUUID(), 10),
          role: roleRow,
          emailVerifiedAt: now,
          isActive: true,
          adminRequestStatus: role === UserRole.ADMIN ? AdminRequestStatus.APPROVED : null,
          adminRequestedAt: null,
          adminApprovedAt: role === UserRole.ADMIN ? now : null,
          adminApprovedById: role === UserRole.ADMIN ? actorId : null,
        }),
      );
    } catch (err) {
      if (isPgError(err, PG_UNIQUE_VIOLATION, 'users_email_uk')) {
        throw new ConflictException('Email address is already in use');
      }
      throw err;
    }
    await this.authService.forgotPassword(user.email);
    this.logger.log(`Account created by admin: user=${user.id} role=${role} by=${actorId}`);
    return toUserResponse(user);
  }

  async update(
    actorId: string,
    userId: string,
    dto: AdminUpdateUserDto,
  ): Promise<UserResponseDto> {
    const target = await this.status.authorize(actorId, userId, 'edit');
    const changed: string[] = [];
    if (dto.name !== undefined) {
      target.name = dto.name;
      changed.push('name');
    }
    if (dto.avatarUrl !== undefined) {
      target.avatarUrl = dto.avatarUrl;
      changed.push('avatarUrl');
    }
    if (dto.resetNoShowCount) {
      target.noShowCount = 0;
      changed.push('noShowCount');
    }
    const saved = changed.length ? await this.users.save(target) : target;
    this.logger.log(
      `Account edited by admin: user=${userId} by=${actorId} fields=${changed.join(',') || 'none'}`,
    );
    return toUserResponse(saved);
  }

  /**
   * SUPER_ADMIN only. Revokes the user's sessions in the same transaction so
   * the next token carries the new role (the current access token keeps the
   * old role until it expires).
   */
  async changeRole(
    actorId: string,
    userId: string,
    role: AssignableRole,
  ): Promise<UserResponseDto> {
    const actor = await this.users.findOneBy({ id: actorId });
    if (!isSuperAdmin(actor)) {
      throw new ForbiddenException('Only a SUPER_ADMIN can change roles');
    }
    const target = await this.status.authorize(actorId, userId, 'edit');
    if (target.role.name === role) return toUserResponse(target);
    if (target.adminRequestStatus === AdminRequestStatus.PENDING) {
      throw new BadRequestException(
        'This user has a pending admin request; approve or reject it instead',
      );
    }
    const roleRow = await this.findRole(role);
    const now = new Date();
    const revoked = await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(User).update(target.id, {
        role: roleRow,
        ...(role === UserRole.ADMIN
          ? {
              adminRequestStatus: AdminRequestStatus.APPROVED,
              adminApprovedAt: now,
              adminApprovedById: actorId,
            }
          : {}),
      });
      return this.authService.revokeAllSessions(manager, target.id);
    });
    this.logger.log(
      `Role changed: user=${target.id} from=${target.role.name} to=${role} by=${actorId} revokedSessions=${revoked}`,
    );
    const updated = await this.users.findOneByOrFail({ id: target.id });
    return toUserResponse(updated);
  }

  private async findRole(name: AssignableRole): Promise<Role> {
    const role = await this.roles.findOneBy({ name });
    if (!role) throw new InternalServerErrorException(`Role ${name} is not configured`);
    return role;
  }
}
