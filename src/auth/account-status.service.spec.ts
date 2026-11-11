import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AccountStatusService } from './account-status.service';
import { User, UserRole } from '../users/entities/user.entity';

// docs/auth.md M3: who may suspend whom, and what suspension does.

const account = (id: string, role: UserRole, isActive = true) =>
  ({ id, role: { name: role }, isActive }) as User;

function build(...accounts: User[]) {
  const usersRepository = {
    findOneBy: jest.fn(
      async ({ id }: { id: string }) => accounts.find((a) => a.id === id) ?? null,
    ),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const authService = { revokeAllSessions: jest.fn().mockResolvedValue(2) };
  const manager = { getRepository: () => usersRepository };
  const dataSource = {
    transaction: jest.fn(async (fn: (m: typeof manager) => unknown) => fn(manager)),
  };
  const service = new AccountStatusService(
    usersRepository as never,
    authService as never,
    dataSource as never,
  );
  return { service, usersRepository, authService, dataSource };
}

const superAdmin = account('super', UserRole.SUPER_ADMIN);
const admin = account('admin', UserRole.ADMIN);
const otherAdmin = account('admin-2', UserRole.ADMIN);
const user = account('user', UserRole.USER);

describe('AccountStatusService', () => {
  it('ADMIN suspends a USER: deactivated and sessions revoked in one transaction', async () => {
    const { service, usersRepository, authService, dataSource } = build(admin, user);

    await service.suspend(admin.id, user.id);

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(usersRepository.update).toHaveBeenCalledWith(user.id, { isActive: false });
    expect(authService.revokeAllSessions).toHaveBeenCalledWith(expect.anything(), user.id);
  });

  it('SUPER_ADMIN may suspend an ADMIN', async () => {
    const { service, usersRepository } = build(superAdmin, admin);

    await service.suspend(superAdmin.id, admin.id);
    expect(usersRepository.update).toHaveBeenCalledWith(admin.id, { isActive: false });
  });

  it.each([
    ['ADMIN suspending another ADMIN', admin, otherAdmin],
    ['ADMIN suspending a SUPER_ADMIN', admin, superAdmin],
    ['SUPER_ADMIN suspending a SUPER_ADMIN', superAdmin, account('super-2', UserRole.SUPER_ADMIN)],
    ['anyone suspending themselves', admin, admin],
    ['a USER suspending someone', user, account('user-2', UserRole.USER)],
    ['a suspended ADMIN', account('admin-off', UserRole.ADMIN, false), user],
  ])('refuses %s (403)', async (_, actor, target) => {
    const { service, usersRepository } = build(actor, target);

    await expect(service.suspend(actor.id, target.id)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(usersRepository.update).not.toHaveBeenCalled();
  });

  it('404 for an unknown account', async () => {
    const { service } = build(admin);

    await expect(service.suspend(admin.id, 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('suspending twice is a no-op', async () => {
    const { service, usersRepository } = build(admin, account('off', UserRole.USER, false));

    await service.suspend(admin.id, 'off');
    expect(usersRepository.update).not.toHaveBeenCalled();
  });

  it('reactivates with the same rules', async () => {
    const off = account('off', UserRole.USER, false);
    const { service, usersRepository } = build(admin, off);

    await service.reactivate(admin.id, off.id);
    expect(usersRepository.update).toHaveBeenCalledWith(off.id, { isActive: true });

    const offAdmin = account('off-admin', UserRole.ADMIN, false);
    const second = build(admin, offAdmin);
    await expect(second.service.reactivate(admin.id, offAdmin.id)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
