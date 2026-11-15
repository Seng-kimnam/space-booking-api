import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError } from 'typeorm';
import { Role } from './entities/role.entity';
import { RolesService } from './roles.service';

// In-memory stand-in for the TypeORM repository, so these tests need no database.
// It mimics the unique constraint on `name` the way TypeORM surfaces it:
// a QueryFailedError whose driverError has Postgres code 23505.
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
      throw new QueryFailedError(
        'INSERT',
        [],
        Object.assign(new Error('duplicate key'), { code: '23505' }),
      );
    }
    if (!role.id) {
      role.id = this.nextId++;
      role.createdAt = role.updatedAt = new Date();
      this.rows.push(role);
    }
    return role;
  }

  // Minimal query builder: WHERE name LIKE :search, ORDER BY, skip/take.
  createQueryBuilder() {
    let search: string | undefined;
    let skip = 0;
    let take = Infinity;
    const qb = {
      where: (_: string, p: { search: string }) => {
        search = p.search.replace(/%/g, '').replace(/\\(.)/g, '$1');
        return qb;
      },
      orderBy: () => qb,
      addOrderBy: () => qb,
      skip: (n: number) => ((skip = n), qb),
      take: (n: number) => ((take = n), qb),
      getManyAndCount: async (): Promise<[Role[], number]> => {
        const rows = this.rows.filter(
          (r) => !search || r.name.includes(search),
        );
        return [rows.slice(skip, skip + take), rows.length];
      },
    };
    return qb;
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

  it('lists roles with pagination metadata', async () => {
    for (const name of ['AA', 'BB', 'CC']) await service.create({ name });
    const page = await service.findAll({ page: 2, limit: 2 });
    expect(page).toMatchObject({ page: 2, limit: 2, total: 3 });
    expect(page.items.map((r) => r.name)).toEqual(['CC']);
  });

  it('filters the list by name, treating LIKE wildcards literally', async () => {
    for (const name of ['MANAGER', 'STAFF_MANAGER', 'GUEST'])
      await service.create({ name });
    const page = await service.findAll({
      page: 1,
      limit: 20,
      search: 'MANAGER',
    });
    expect(page.items.map((r) => r.name)).toEqual(['MANAGER', 'STAFF_MANAGER']);
    expect(
      (await service.findAll({ page: 1, limit: 20, search: '_' })).items.map(
        (r) => r.name,
      ),
    ).toEqual(['STAFF_MANAGER']);
  });

  it('throws 404 when the role does not exist', async () => {
    await expect(service.findOne(999)).rejects.toThrow(NotFoundException);
  });

  it('finds a role by name, case-insensitively', async () => {
    await service.create({ name: 'USER' });
    expect((await service.findByName(' user '))?.name).toBe('USER');
    expect(await service.findByName('NOPE')).toBeNull();
  });

  it('renames a role', async () => {
    const role = await service.create({ name: 'OLD' });
    const updated = await service.update(role.id, { name: 'NEW' });
    expect(updated.name).toBe('NEW');
  });

  it('treats an empty or same-name update as a no-op', async () => {
    const admin = await service.create({ name: 'ADMIN' });
    await expect(service.update(admin.id, {})).resolves.toMatchObject({
      name: 'ADMIN',
    });
    await expect(
      service.update(admin.id, { name: 'ADMIN' }),
    ).resolves.toMatchObject({ name: 'ADMIN' });
  });

  it('rejects renaming to an existing name with 409', async () => {
    await service.create({ name: 'AA' });
    const b = await service.create({ name: 'BB' });
    await expect(service.update(b.id, { name: 'AA' })).rejects.toThrow(
      ConflictException,
    );
  });

  it('throws 404 when updating or deleting an unknown role', async () => {
    await expect(service.update(999, { name: 'X1' })).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.remove(999)).rejects.toThrow(NotFoundException);
  });

  it.each(['ADMIN', 'USER'])('refuses to rename %s', async (name) => {
    const role = await service.create({ name });
    await expect(service.update(role.id, { name: 'OTHER' })).rejects.toThrow(
      ConflictException,
    );
    expect((await service.findOne(role.id)).name).toBe(name);
  });

  it('deletes a normal role', async () => {
    const role = await service.create({ name: 'TEMP' });
    await service.remove(role.id);
    await expect(service.findOne(role.id)).rejects.toThrow(NotFoundException);
  });

  it.each(['ADMIN', 'USER'])('refuses to delete %s', async (name) => {
    const role = await service.create({ name });
    await expect(service.remove(role.id)).rejects.toThrow(ConflictException);
  });
});

describe('RolesService logging', () => {
  let service: RolesService;
  let log: jest.SpyInstance;
  let warn: jest.SpyInstance;

  beforeEach(async () => {
    // Spy on the Logger class: RolesService's `new Logger(...)` instance uses it,
    // and in the app it forwards to AppLogger. mockImplementation keeps test output quiet.
    log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const moduleRef = await Test.createTestingModule({
      providers: [
        RolesService,
        { provide: getRepositoryToken(Role), useClass: FakeRolesRepository },
      ],
    }).compile();
    service = moduleRef.get(RolesService);
    // compile() logs Nest's own "dependencies initialized" lines; start clean.
    log.mockClear();
    warn.mockClear();
  });

  afterEach(() => jest.restoreAllMocks());

  it('logs create, rename and delete with id and names', async () => {
    const role = await service.create({ name: 'MANAGER' });
    await service.update(role.id, { name: 'SUPERVISOR' });
    await service.remove(role.id);
    expect(log.mock.calls.map(([msg]) => msg)).toEqual([
      `Role created: id=${role.id} name=MANAGER`,
      `Role renamed: id=${role.id} MANAGER -> SUPERVISOR`,
      `Role deleted: id=${role.id} name=SUPERVISOR`,
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns on rejected writes and logs no success line for them', async () => {
    const admin = await service.create({ name: 'ADMIN' });
    log.mockClear();
    await expect(service.create({ name: 'ADMIN' })).rejects.toThrow(
      ConflictException,
    );
    await expect(service.update(admin.id, { name: 'ROOT' })).rejects.toThrow(
      ConflictException,
    );
    await expect(service.remove(admin.id)).rejects.toThrow(ConflictException);
    expect(warn.mock.calls.map(([msg]) => msg)).toEqual([
      'Rejected: duplicate role name=ADMIN',
      `Rejected: protected role cannot be renamed: id=${admin.id} name=ADMIN`,
      `Rejected: protected role cannot be deleted: id=${admin.id} name=ADMIN`,
    ]);
    expect(log).not.toHaveBeenCalled();
  });

  it('does not log reads or no-op updates', async () => {
    const role = await service.create({ name: 'MANAGER' });
    log.mockClear();
    await service.findOne(role.id);
    await service.findAll({ page: 1, limit: 20 });
    await service.update(role.id, {});
    await service.update(role.id, { name: 'MANAGER' });
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});
