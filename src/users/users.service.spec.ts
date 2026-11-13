import { NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { EntityManager, Repository } from 'typeorm';
import { UserRole } from '../common/enums';
import { ListUsersQueryDto } from './dto/user.dto';
import { AdminRequestStatus, User } from './entities/user.entity';
import { UsersService } from './users.service';

const user = (over: Partial<User> = {}): User =>
  ({
    id: 'u1',
    name: 'Jane',
    email: 'jane@example.com',
    passwordHash: 'secret-hash',
    googleId: 'g-123',
    avatarUrl: null,
    emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
    isActive: true,
    noShowCount: 2,
    adminRequestStatus: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    role: { id: 3, name: UserRole.USER },
    ...over,
  }) as User;

function setup(rows: User[] = [user()]) {
  const where: [string, Record<string, unknown> | undefined][] = [];
  const paging: { skip?: number; take?: number } = {};
  const qb = {
    innerJoinAndSelect: () => qb,
    orderBy: () => qb,
    addOrderBy: () => qb,
    skip: (n: number) => ((paging.skip = n), qb),
    take: (n: number) => ((paging.take = n), qb),
    andWhere: (sql: string, params?: Record<string, unknown>) => (where.push([sql, params]), qb),
    getManyAndCount: async () => [rows, 42],
  };
  const repo = {
    createQueryBuilder: () => qb,
    findOneBy: jest.fn(async ({ id }: { id: string }) => rows.find((r) => r.id === id) ?? null),
    save: jest.fn(async (u: User) => u),
  } as unknown as Repository<User>;
  return { svc: new UsersService(repo), repo, where, paging };
}

describe('UsersService', () => {
  it('lists with paging and every filter, escaping LIKE wildcards in q', async () => {
    const { svc, where, paging } = setup();
    const query = plainToInstance(ListUsersQueryDto, {
      page: 3,
      limit: 10,
      role: UserRole.ADMIN,
      isActive: false,
      adminRequestStatus: AdminRequestStatus.PENDING,
      q: '50%_off',
    });
    const page = await svc.list(query);

    expect(paging).toEqual({ skip: 20, take: 10 });
    expect(where.map(([, p]) => p)).toEqual([
      { role: UserRole.ADMIN },
      { active: false },
      { ars: AdminRequestStatus.PENDING },
      { q: '%50\\%\\_off%' },
    ]);
    expect(page).toMatchObject({ page: 3, limit: 10, total: 42 });
  });

  it('never returns the password hash or provider id', async () => {
    const { svc } = setup();
    const page = await svc.list(plainToInstance(ListUsersQueryDto, {}));
    const one = await svc.get('u1');
    for (const body of [JSON.stringify(page), JSON.stringify(one)]) {
      expect(body).not.toContain('secret-hash');
      expect(body).not.toContain('g-123');
    }
    expect(one).toMatchObject({ id: 'u1', role: UserRole.USER, noShowCount: 2 });
  });

  it('adds no filters when none are given', async () => {
    const { svc, where } = setup();
    await svc.list(plainToInstance(ListUsersQueryDto, {}));
    expect(where).toEqual([]);
  });

  it('returns 404 for an unknown user', async () => {
    await expect(setup().svc.get('nope')).rejects.toThrow(NotFoundException);
    await expect(setup().svc.updateMyProfile('nope', { name: 'x' })).rejects.toThrow(
      NotFoundException,
    );
  });

  it('updates only the given profile fields; null clears the avatar', async () => {
    const { svc, repo } = setup([user({ avatarUrl: 'https://img.example/a.png' })]);
    const res = await svc.updateMyProfile('u1', { avatarUrl: null });
    const saved = (repo.save as jest.Mock).mock.calls[0][0] as User;
    expect(saved.avatarUrl).toBeNull();
    expect(saved.name).toBe('Jane');
    expect(res).toEqual({
      id: 'u1',
      email: 'jane@example.com',
      name: 'Jane',
      role: UserRole.USER,
      emailVerifiedAt: '2026-01-01T00:00:00.000Z',
      avatarUrl: null,
    });
  });

  it('does not write when the body is empty', async () => {
    const { svc, repo } = setup();
    await svc.updateMyProfile('u1', {});
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('increments no_show_count on the caller-provided manager', async () => {
    const manager = { query: jest.fn() } as unknown as EntityManager;
    await setup().svc.incrementNoShow(manager, 'u1');
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('no_show_count = no_show_count + 1'),
      ['u1'],
    );
  });
});
