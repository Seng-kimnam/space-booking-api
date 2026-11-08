import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { Role } from './entities/role.entity';

// Postgres error code for a unique constraint violation
const UNIQUE_VIOLATION = '23505';
// The app depends on these two roles, so they can't be deleted
const PROTECTED_ROLES = ['ADMIN', 'USER'];

@Injectable()
export class RolesService {
  constructor(
    @InjectRepository(Role)
    private readonly rolesRepository: Repository<Role>,
  ) {}

  async create(dto: CreateRoleDto): Promise<Role> {
    try {
      return await this.rolesRepository.save(this.rolesRepository.create(dto));
    } catch (error) {
      this.rethrowIfDuplicate(error, dto.name);
      throw error;
    }
  }

  findAll(): Promise<Role[]> {
    return this.rolesRepository.find({ order: { id: 'ASC' } });
  }

  async findOne(id: number): Promise<Role> {
    const role = await this.rolesRepository.findOneBy({ id });
    if (!role) {
      throw new NotFoundException(`Role ${id} not found`);
    }
    return role;
  }

  // Other modules (e.g. auth) use this to look up a role by name
  async findByName(name: string): Promise<Role | null> {
    return this.rolesRepository.findOneBy({ name });
  }

  async update(id: number, dto: UpdateRoleDto): Promise<Role> {
    const role = await this.findOne(id);
    Object.assign(role, dto);
    try {
      return await this.rolesRepository.save(role);
    } catch (error) {
      this.rethrowIfDuplicate(error, dto.name);
      throw error;
    }
  }

  async remove(id: number): Promise<void> {
    const role = await this.findOne(id);
    if (PROTECTED_ROLES.includes(role.name)) {
      throw new ConflictException(`Role ${role.name} cannot be deleted`);
    }
    await this.rolesRepository.remove(role);
  }

  private rethrowIfDuplicate(error: unknown, name?: string): void {
    const code = (error as { code?: string }).code;
    if (code === UNIQUE_VIOLATION) {
      throw new ConflictException(`Role "${name}" already exists`);
    }
  }
}