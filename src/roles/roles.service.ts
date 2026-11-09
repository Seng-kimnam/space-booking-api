import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { isPgError, PG_UNIQUE_VIOLATION } from '../common/utils/db-errors';
import { UserRole } from '../users/entities/user.entity';
import { CreateRoleDto } from './dto/create-role.dto';
import { RoleQueryDto } from './dto/role-query.dto';
import { RolePageResponseDto, RoleResponseDto } from './dto/role-response.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { Role } from './entities/role.entity';

// Login and every @Roles(...) check rely on these names (users.role enum),
// so they can't be renamed or deleted. Other roles are free to manage.
export const PROTECTED_ROLES: readonly string[] = Object.values(UserRole);

/** Escapes LIKE wildcards so the search text is matched literally. */
const likeLiteral = (s: string) => `%${s.replace(/[\\%_]/g, '\\$&')}%`;

@Injectable()
export class RolesService {
  // Nest's Logger forwards to the app logger set in main.ts (AppLogger), so
  // these lines get its console format and, with LOG_FILE, the JSON file for Loki.
  // Writes are logged as an audit trail; reads are not (noise). Unexpected DB
  // errors are not logged here either: Nest's exception handler already logs 500s.
  private readonly logger = new Logger(RolesService.name);

  constructor(
    @InjectRepository(Role)
    private readonly rolesRepository: Repository<Role>,
  ) {}

  async create(dto: CreateRoleDto): Promise<Role> {
    const role = await this.save(
      this.rolesRepository.create({ name: dto.name }),
      dto.name,
    );
    this.logger.log(`Role created: id=${role.id} name=${role.name}`);
    return role;
  }

  async findAll(query: RoleQueryDto): Promise<RolePageResponseDto> {
    const qb = this.rolesRepository.createQueryBuilder('role');
    // Names are stored uppercase (CreateRoleDto), and search is uppercased too.
    if (query.search)
      qb.where('role.name LIKE :search', { search: likeLiteral(query.search) });
    const [rows, total] = await qb
      .orderBy('role.id', 'ASC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();
    return {
      items: rows.map((role) => RoleResponseDto.from(role)),
      page: query.page,
      limit: query.limit,
      total,
    };
  }

  async findOne(id: number): Promise<Role> {
    const role = await this.rolesRepository.findOneBy({ id });
    if (!role) throw new NotFoundException(`Role ${id} not found`);
    return role;
  }

  findByName(name: string): Promise<Role | null> {
    return this.rolesRepository.findOneBy({ name: name.trim().toUpperCase() });
  }

  async update(id: number, dto: UpdateRoleDto): Promise<Role> {
    const role = await this.findOne(id);
    // Nothing to change: no-op, even for protected roles.
    if (dto.name === undefined || dto.name === role.name) return role;
    this.assertNotProtected(role, 'renamed');
    const oldName = role.name;
    role.name = dto.name;
    const saved = await this.save(role, dto.name);
    this.logger.log(`Role renamed: id=${id} ${oldName} -> ${saved.name}`);
    return saved;
  }

  async remove(id: number): Promise<void> {
    const role = await this.findOne(id);
    this.assertNotProtected(role, 'deleted');
    // Read before remove(): TypeORM clears the entity's id once it's deleted.
    const { name } = role;
    await this.rolesRepository.remove(role);
    this.logger.log(`Role deleted: id=${id} name=${name}`);
  }

  private assertNotProtected(role: Role, action: 'renamed' | 'deleted'): void {
    if (PROTECTED_ROLES.includes(role.name)) {
      this.logger.warn(
        `Rejected: protected role cannot be ${action}: id=${role.id} name=${role.name}`,
      );
      throw new ConflictException(`Role ${role.name} cannot be ${action}`);
    }
  }

  // The unique index on name is the real guard against duplicates, so two
  // concurrent creates can't both succeed (no check-then-insert race).
  private async save(role: Role, name: string): Promise<Role> {
    try {
      return await this.rolesRepository.save(role);
    } catch (error) {
      if (isPgError(error, PG_UNIQUE_VIOLATION)) {
        this.logger.warn(`Rejected: duplicate role name=${name}`);
        throw new ConflictException(`Role "${name}" already exists`);
      }
      throw error;
    }
  }
}
