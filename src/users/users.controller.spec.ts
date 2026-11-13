import { Test, TestingModule } from '@nestjs/testing';
import { AuthGuard } from '../auth/auth.guard';
import { AccountStatusService } from './account-status.service';
import { AdminUsersController } from './admin-users.controller';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('Users controllers', () => {
  let module: TestingModule;
  const users = { updateMyProfile: jest.fn(), list: jest.fn(), get: jest.fn() };
  const accounts = { suspend: jest.fn(), reactivate: jest.fn() };

  beforeEach(async () => {
    module = await Test.createTestingModule({
      controllers: [UsersController, AdminUsersController],
      providers: [
        { provide: UsersService, useValue: users },
        { provide: AccountStatusService, useValue: accounts },
      ],
    })
      // The guard's own behaviour is tested elsewhere; this only checks wiring.
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
  });

  it('updates the caller\'s own profile by the authenticated id', async () => {
    await module.get(UsersController).updateMe({ id: 'me', role: 'USER' as never }, { name: 'N' });
    expect(users.updateMyProfile).toHaveBeenCalledWith('me', { name: 'N' });
  });

  it('delegates admin reads to the service', async () => {
    const ctrl = module.get(AdminUsersController);
    await ctrl.get('u1');
    expect(users.get).toHaveBeenCalledWith('u1');
  });

  it('suspends and reactivates as the authenticated admin', async () => {
    const ctrl = module.get(AdminUsersController);
    const actor = { id: 'admin', role: 'ADMIN' as never };
    await ctrl.suspend(actor, 'u1');
    await ctrl.reactivate(actor, 'u1');
    expect(accounts.suspend).toHaveBeenCalledWith('admin', 'u1');
    expect(accounts.reactivate).toHaveBeenCalledWith('admin', 'u1');
  });
});
