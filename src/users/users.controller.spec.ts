import { Test, TestingModule } from '@nestjs/testing';
import { AuthGuard } from '../auth/guards/auth.guard';
import { AuthService } from '../auth/services/auth.service';
import { SessionsService } from '../auth/services/sessions.service';
import { AccountStatusService } from './account-status.service';
import { AdminAccountsService } from './admin-accounts.service';
import { AdminUsersController } from './admin-users.controller';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('Users controllers', () => {
  let module: TestingModule;
  const users = {
    updateMyProfile: jest.fn(),
    getDetail: jest.fn(),
    profile: jest.fn(),
  };
  const accounts = {
    suspend: jest.fn(),
    reactivate: jest.fn(),
    closeOwn: jest.fn(),
    listSessions: jest.fn().mockResolvedValue([]),
  };
  const sessions = {
    list: jest.fn().mockResolvedValue([
      { id: 's1', userAgent: 'ua', ip: '1.2.3.4', lastActiveAt: new Date(0), expiresAt: new Date(0) },
      { id: 's2', userAgent: null, ip: null, lastActiveAt: new Date(0), expiresAt: new Date(0) },
    ]),
    revoke: jest.fn(),
  };
  const auth = { confirmEmailChange: jest.fn().mockResolvedValue({ id: 'me' }) };

  beforeEach(async () => {
    module = await Test.createTestingModule({
      controllers: [UsersController, AdminUsersController],
      providers: [
        { provide: UsersService, useValue: users },
        { provide: AccountStatusService, useValue: accounts },
        { provide: AdminAccountsService, useValue: {} },
        { provide: SessionsService, useValue: sessions },
        { provide: AuthService, useValue: auth },
      ],
    })
      // The guard's own behaviour is tested elsewhere; this only checks wiring.
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
  });

  const me = { id: 'me', role: 'USER' as never, sessionId: 's2' };

  it('acts on the authenticated account only', async () => {
    const ctrl = module.get(UsersController);
    await ctrl.updateMe(me, { name: 'N' });
    expect(users.updateMyProfile).toHaveBeenCalledWith('me', { name: 'N' });
    await ctrl.closeMe(me, { password: 'pw' });
    expect(accounts.closeOwn).toHaveBeenCalledWith('me', 'pw');
    await ctrl.revokeSession(me, 's1');
    expect(sessions.revoke).toHaveBeenCalledWith('me', 's1');
  });

  it('marks the session making the request as current', async () => {
    const list = await module.get(UsersController).sessionsOf(me);
    expect(list.map((s) => [s.id, s.current])).toEqual([
      ['s1', false],
      ['s2', true],
    ]);
  });

  it('returns the full profile after an email change', async () => {
    await module.get(UsersController).confirmEmailChange(me, { otp: '123456' });
    expect(auth.confirmEmailChange).toHaveBeenCalledWith('me', '123456');
    expect(users.profile).toHaveBeenCalledWith({ id: 'me' });
  });

  it('admin routes pass the authenticated actor', async () => {
    const ctrl = module.get(AdminUsersController);
    const actor = { id: 'admin', role: 'ADMIN' as never };
    await ctrl.get('u1');
    expect(users.getDetail).toHaveBeenCalledWith('u1');
    await ctrl.suspend(actor, 'u1');
    await ctrl.reactivate(actor, 'u1');
    expect(accounts.suspend).toHaveBeenCalledWith('admin', 'u1');
    expect(accounts.reactivate).toHaveBeenCalledWith('admin', 'u1');
  });
});
