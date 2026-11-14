import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { UserRole } from '../common/enums';
import { AdminAccountsService } from './admin-accounts.service';
import { AdminRequestStatus, User } from './entities/user.entity';

const account = (id: string, role: UserRole, over: Partial<User> = {}) =>
  ({
    id,
    name: id,
    email: `${id}@x.test`,
    role: { id: 1, name: role },
    isActive: true,
    deletedAt: null,
    noShowCount: 4,
    avatarUrl: null,
    adminRequestStatus: null,
    emailVerifiedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  }) as User;

const superAdmin = account('super', UserRole.SUPER_ADMIN);
const admin = account('admin', UserRole.ADMIN);
const user = account('user', UserRole.USER);

function build(accounts: User[], saveError?: unknown) {
  const users = {
    findOneBy: jest.fn(async ({ id }: { id: string }) => accounts.find((a) => a.id === id) ?? null),
    findOneByOrFail: jest.fn(async ({ id }: { id: string }) => accounts.find((a) => a.id === id)!),
    create: (v: Partial<User>) => ({ ...v }),
    save: jest.fn(async (v: User) => {
      if (saveError) throw saveError;
      return Object.assign(
        { id: 'new', createdAt: new Date(), updatedAt: new Date(), noShowCount: 0 },
        v,
      ) as User;
    }),
  };
  const roles = {
    findOneBy: jest.fn(async ({ name }: { name: string }) => ({ id: name === 'ADMIN' ? 2 : 3, name })),
  };
  const status = {
    authorize: jest.fn(async (_a: string, id: string) => accounts.find((a) => a.id === id)!),
  };
  const repo = { update: jest.fn() };
  const manager = { getRepository: () => repo };
  const auth = {
    forgotPassword: jest.fn().mockResolvedValue({}),
    revokeAllSessions: jest.fn().mockResolvedValue(1),
  };
  const ds = { transaction: jest.fn(async (fn: (m: unknown) => unknown) => fn(manager)) };
  const svc = new AdminAccountsService(
    users as never,
    roles as never,
    status as never,
    auth as never,
    ds as never,
  );
  return { svc, users, status, auth, repo };
}

describe('AdminAccountsService', () => {
  it('creates a verified USER with an unusable password and mails a set-password code', async () => {
    const { svc, users, auth } = build([admin]);
    const res = await svc.create(admin.id, { name: 'Jane', email: 'jane@x.test' });

    const saved = users.save.mock.calls[0][0] as User;
    expect(saved.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(saved.emailVerifiedAt).toBeInstanceOf(Date);
    expect(auth.forgotPassword).toHaveBeenCalledWith('jane@x.test');
    expect(res).not.toHaveProperty('passwordHash');
    expect(res.role).toBe(UserRole.USER);
  });

  it('only a SUPER_ADMIN creates ADMIN accounts, approved by them', async () => {
    await expect(
      build([admin]).svc.create(admin.id, { name: 'A', email: 'a@x.test', role: UserRole.ADMIN }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const { svc, users } = build([superAdmin]);
    await svc.create(superAdmin.id, { name: 'A', email: 'a@x.test', role: UserRole.ADMIN });
    expect(users.save.mock.calls[0][0]).toMatchObject({
      adminRequestStatus: AdminRequestStatus.APPROVED,
      adminApprovedById: superAdmin.id,
    });
  });

  it('maps a taken email to 409', async () => {
    const dup = Object.assign(new QueryFailedError('q', [], new Error('x')), {
      driverError: { code: '23505', constraint: 'users_email_uk' },
    });
    await expect(
      build([admin], dup).svc.create(admin.id, { name: 'J', email: 'j@x.test' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('edits through the account policy and can reset no-shows', async () => {
    const { svc, status, users } = build([admin, user]);
    const res = await svc.update(admin.id, user.id, { name: 'New', resetNoShowCount: true });
    expect(status.authorize).toHaveBeenCalledWith(admin.id, user.id, 'edit');
    expect(users.save.mock.calls[0][0]).toMatchObject({ name: 'New', noShowCount: 0 });
    expect(res.name).toBe('New');
  });

  it('role change: SUPER_ADMIN only, revokes sessions, records the approval', async () => {
    await expect(build([admin, user]).svc.changeRole(admin.id, user.id, UserRole.ADMIN)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    const { svc, repo, auth } = build([superAdmin, user]);
    await svc.changeRole(superAdmin.id, user.id, UserRole.ADMIN);
    expect(repo.update).toHaveBeenCalledWith(user.id, expect.objectContaining({
      role: { id: 2, name: 'ADMIN' },
      adminRequestStatus: AdminRequestStatus.APPROVED,
      adminApprovedById: superAdmin.id,
    }));
    expect(auth.revokeAllSessions).toHaveBeenCalledWith(expect.anything(), user.id);
  });

  it('role change is a no-op for the same role and refused for a pending admin request', async () => {
    const same = build([superAdmin, user]);
    await same.svc.changeRole(superAdmin.id, user.id, UserRole.USER);
    expect(same.repo.update).not.toHaveBeenCalled();

    const pending = account('p', UserRole.USER, { adminRequestStatus: AdminRequestStatus.PENDING });
    await expect(
      build([superAdmin, pending]).svc.changeRole(superAdmin.id, pending.id, UserRole.ADMIN),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
