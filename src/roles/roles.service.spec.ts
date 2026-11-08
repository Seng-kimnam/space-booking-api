import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Role } from './entities/role.entity';
import { RolesService } from './roles.service';

// In-memory stand-in for the TypeORM repository, so these tests need no database.
// It mimics the unique constraint on `name` by throwing Postgres code 23505.
class FakeRolesRepository {
  rows: Role[] = [];
  private nextId = 1;

  create(data: Partial<Role>): Role {
    return Object.assign(new Role(), data);
  }

  async save(role: Role): Promise<Role> {
    const duplicate = this.rows.some(
      (r) => r.name === role.name && r.id !== role.id,
    );
    if (duplicate) {
      throw Object.assign(new Error('duplicate key'), { code: '23505' });
    }
    if (!role.id) {
      role.id = this.nextId++;
      this.rows.push(role);
    }
    return role;
  }

  async find(): Promise<Role[]> {
    return [...this.rows];
  }

  async findOneBy(where: { id?: number; name?: string }): Promise<Role | null> {
    return (
      this.rows.find(
        (r) =>
          (where.id === undefined || r.id === where.id) &&
          (where.name === undefined || r.name === where.name),
      ) ?? null
    );
  }

  async remove(role: Role): Promise<Role> {
    this.rows = this.rows.filter((r) => r.id !== role.id);
    return role;
  }
}

describe('RolesService', () => {
  let service: RolesService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        RolesService,
        { provide: getRepositoryToken(Role), useClass: FakeRolesRepository },
      ],
    }).compile();
    service = moduleRef.get(RolesService);
  });

  it('creates a role', async () => {
    const role = await service.create({ name: 'MANAGER' });
    expect(role.id).toBeDefined();
    expect(role.name).toBe('MANAGER');
  });

  it('rejects a duplicate name with 409', async () => {
    await service.create({ name: 'MANAGER' });
    await expect(service.create({ name: 'MANAGER' })).rejects.toThrow(
      ConflictException,
    );
  });

  it('lists all roles', async () => {
    await service.create({ name: 'A' });
    await service.create({ name: 'B' });
    expect(await service.findAll()).toHaveLength(2);
  });

  it('throws 404 when the role does not exist', async () => {
    await expect(service.findOne(999)).rejects.toThrow(NotFoundException);
  });

  it('finds a role by name', async () => {
    await service.create({ name: 'USER' });
    expect((await service.findByName('USER'))?.name).toBe('USER');
    expect(await service.findByName('NOPE')).toBeNull();
  });

  it('renames a role', async () => {
    const role = await service.create({ name: 'OLD' });
    const updated = await service.update(role.id, { name: 'NEW' });
    expect(updated.name).toBe('NEW');
  });

  it('rejects renaming to an existing name with 409', async () => {
    await service.create({ name: 'A' });
    const b = await service.create({ name: 'B' });
    await expect(service.update(b.id, { name: 'A' })).rejects.toThrow(
      ConflictException,
    );
  });

  it('deletes a normal role', async () => {
    const role = await service.create({ name: 'TEMP' });
    await service.remove(role.id);
    await expect(service.findOne(role.id)).rejects.toThrow(NotFoundException);
  });

  it('refuses to delete ADMIN or USER', async () => {
    const admin = await service.create({ name: 'ADMIN' });
    await expect(service.remove(admin.id)).rejects.toThrow(ConflictException);
  });
});