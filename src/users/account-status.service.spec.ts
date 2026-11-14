import { ConflictException, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { AccountStatusService } from './account-status.service';
import { User, UserRole } from './entities/user.entity';

// docs/auth.md M3: who may suspend whom, and what suspension does.

const account = (id: string, role: UserRole, isActive = true, deletedAt: Date | null = null) =>
  ({ id, role: { name: role }, isActive, deletedAt, passwordHash: null }) as User;

function build(...accounts: User[]) {
  const usersRepository = {
    findOneBy: jest.fn(
      async ({ id }: { id: string }) => accounts.find((a) => a.id === id) ?? null,
    ),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const authService = {
    revokeAllSessions: jest.fn().mockResolvedValue(2),
    assertPassword: jest.fn().mockResolvedValue(undefined),
  };
  const sessions = { list: jest.fn().mockResolvedValue([]) };
  const bookings = {
    hasSeatInUse: jest.fn().mockResolvedValue(false),
    cancelAllPending: jest.fn().mockResolvedValue(3),
  };
  const manager = { getRepository: () => usersRepository, query: jest.fn() };
  const dataSource = {
    transaction: jest.fn(async (fn: (m: typeof manager) => unknown) => fn(manager)),
  };
  const service = new AccountStatusService(
    usersRepository as never,
    authService as never,
    sessions as never,
    dataSource as never,
    bookings as never,
  );
  return { service, usersRepository, authService, sessions, bookings, dataSource, manager };
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

  describe('closing accounts', () => {
    it('owner closes: password checked, lock taken, pending cancelled, closed, sessions revoked', async () => {
      const { service, usersRepository, authService, bookings, manager } = build(user);

      await service.closeOwn(user.id, 'pw');

      expect(authService.assertPassword).toHaveBeenCalledWith(user, 'pw');
      expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('FOR UPDATE'), [user.id]);
      expect(bookings.cancelAllPending).toHaveBeenCalledWith(manager, user.id, user.id, expect.any(Date));
      expect(usersRepository.update).toHaveBeenCalledWith(user.id, {
        deletedAt: expect.any(Date),
        pendingEmail: null,
      });
      expect(authService.revokeAllSessions).toHaveBeenCalledWith(manager, user.id);
    });

    it('wrong password stops before anything changes', async () => {
      const { service, authService, bookings } = build(user);
      authService.assertPassword.mockRejectedValue(new UnauthorizedException());

      await expect(service.closeOwn(user.id, 'nope')).rejects.toBeInstanceOf(UnauthorizedException);
      expect(bookings.cancelAllPending).not.toHaveBeenCalled();
    });

    it('409 while a seat is in use; nothing is cancelled', async () => {
      const { service, bookings, usersRepository } = build(user);
      bookings.hasSeatInUse.mockResolvedValue(true);

      await expect(service.closeOwn(user.id, 'pw')).rejects.toBeInstanceOf(ConflictException);
      expect(bookings.cancelAllPending).not.toHaveBeenCalled();
      expect(usersRepository.update).not.toHaveBeenCalled();
    });

    it('admin closes with the admin as actor; closing twice is a no-op', async () => {
      const { service, bookings } = build(admin, user);
      await service.closeByAdmin(admin.id, user.id);
      expect(bookings.cancelAllPending).toHaveBeenCalledWith(expect.anything(), user.id, admin.id, expect.any(Date));

      const closed = account('closed', UserRole.USER, true, new Date());
      const again = build(admin, closed);
      await again.service.closeByAdmin(admin.id, closed.id);
      expect(again.bookings.cancelAllPending).not.toHaveBeenCalled();
    });

    it('a closed owner gets 404', async () => {
      const closed = account('closed', UserRole.USER, true, new Date());
      await expect(build(closed).service.closeOwn(closed.id, 'pw')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('restores a closed account; other actions on it are 409', async () => {
      const closed = account('closed', UserRole.USER, true, new Date());
      const { service, usersRepository } = build(admin, closed);

      await expect(service.suspend(admin.id, closed.id)).rejects.toBeInstanceOf(ConflictException);
      await service.restore(admin.id, closed.id);
      expect(usersRepository.update).toHaveBeenCalledWith(closed.id, { deletedAt: null });
    });
  });

  it('verifies an email once, and revokes sessions under the same rules', async () => {
    const unverified = { ...account('u-new', UserRole.USER), emailVerifiedAt: null } as User;
    const { service, usersRepository, authService } = build(admin, unverified);

    await service.verifyEmail(admin.id, unverified.id);
    expect(usersRepository.update).toHaveBeenCalledWith(unverified.id, {
      emailVerifiedAt: expect.any(Date),
    });
    await service.revokeSessions(admin.id, unverified.id);
    expect(authService.revokeAllSessions).toHaveBeenCalled();

    await expect(build(admin, otherAdmin).service.revokeSessions(admin.id, otherAdmin.id)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
