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
    pendingEmail: null,
    avatarUrl: null,
    emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
    isActive: true,
    noShowCount: 2,
    adminRequestStatus: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    deletedAt: null,
    role: { id: 3, name: UserRole.USER },
    ...over,
  }) as User;

const linked = {
  telegram: { linked: true, username: 'jane_t', linkedAt: new Date('2026-02-01T00:00:00Z') },
  external: [],
};
const summary = {
  total: 4, upcoming: 1, active: 0, completed: 2, cancelled: 1, expired: 0,
  hoursBooked: 2.3333333, favouritePlace: null,
};

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
  const bookings = {
    summary: jest.fn().mockResolvedValue(summary),
    activity: jest.fn().mockResolvedValue({
      items: [{ id: 'e1', bookingId: 'b1', type: 'CREATED', actor: 'SELF', ownBooking: true,
        placeName: 'Lib', seatLabel: 'A1', createdAt: new Date('2026-03-01T00:00:00Z') }],
      total: 1,
    }),
  };
  const notifications = { list: jest.fn().mockResolvedValue({ items: [], total: 0 }) };
  const links = { forUser: jest.fn().mockResolvedValue(linked) };
  const svc = new UsersService(repo, bookings as never, notifications as never, links as never);
  return { svc, repo, where, paging, bookings, notifications, links };
}

describe('UsersService', () => {
  it('lists open accounts with paging and every filter, escaping LIKE wildcards in q', async () => {
    const { svc, where, paging } = setup();
    const query = plainToInstance(ListUsersQueryDto, {
      page: 3,
      limit: 10,
      role: UserRole.ADMIN,
      isActive: 'false',
      adminRequestStatus: AdminRequestStatus.PENDING,
      q: '50%_off',
    });
    const page = await svc.list(query);

    expect(paging).toEqual({ skip: 20, take: 10 });
    expect(where[0][0]).toBe('u.deleted_at IS NULL');
    expect(where.slice(1).map(([, p]) => p)).toEqual([
      { role: UserRole.ADMIN },
      { active: false },
      { ars: AdminRequestStatus.PENDING },
      { q: '%50\\%\\_off%' },
    ]);
    expect(page).toMatchObject({ page: 3, limit: 10, total: 42 });
  });

  it('lists only closed accounts with deleted=true', async () => {
    const { svc, where } = setup();
    await svc.list(plainToInstance(ListUsersQueryDto, { deleted: 'true' }));
    expect(where).toEqual([['u.deleted_at IS NOT NULL', undefined]]);
  });

  it('admin detail adds sign-in methods, links and stats, but never secrets', async () => {
    const { svc } = setup();
    const detail = await svc.getDetail('u1');
    expect(detail).toMatchObject({
      id: 'u1',
      hasPassword: true,
      googleLinked: true,
      linkedAccounts: { telegram: { linked: true, username: 'jane_t' } },
      bookings: { total: 4, hoursBooked: 2.33 },
    });
    const body = JSON.stringify(detail);
    expect(body).not.toContain('secret-hash');
    expect(body).not.toContain('g-123');
  });

  it('own profile includes linked accounts; a closed account is 404 to its owner', async () => {
    const { svc } = setup([user(), user({ id: 'gone', deletedAt: new Date() })]);
    await expect(svc.getMe('u1')).resolves.toMatchObject({
      noShowCount: 2,
      hasPassword: true,
      linkedAccounts: { telegram: { linked: true } },
    });
    await expect(svc.getMe('gone')).rejects.toThrow(NotFoundException);
    await expect(svc.getMe('nope')).rejects.toThrow(NotFoundException);
  });

  it('updates only the given profile fields; null clears the avatar', async () => {
    const { svc, repo } = setup([user({ avatarUrl: 'https://img.example/a.png' })]);
    const res = await svc.updateMyProfile('u1', { avatarUrl: null });
    const saved = (repo.save as jest.Mock).mock.calls[0][0] as User;
    expect(saved.avatarUrl).toBeNull();
    expect(saved.name).toBe('Jane');
    expect(res).toMatchObject({ id: 'u1', name: 'Jane', avatarUrl: null });
  });

  it('does not write when the body is empty', async () => {
    const { svc, repo } = setup();
    await svc.updateMyProfile('u1', {});
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('notifications: errors only in the admin view', async () => {
    const { svc, notifications } = setup();
    await svc.notificationsOf('u1', 2, 5, false);
    expect(notifications.list).toHaveBeenCalledWith('u1', 2, 5, false);
    await svc.notificationsOf('u1', 1, 20, true);
    expect(notifications.list).toHaveBeenLastCalledWith('u1', 1, 20, true);
  });

  it('activity maps dates and keeps paging', async () => {
    const { svc } = setup();
    await expect(svc.activityOf('u1', 1, 20, false)).resolves.toEqual({
      items: [expect.objectContaining({ id: 'e1', createdAt: '2026-03-01T00:00:00.000Z' })],
      page: 1,
      limit: 20,
      total: 1,
    });
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
