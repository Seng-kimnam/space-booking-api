import * as bcrypt from 'bcrypt';
import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { IsNull, QueryFailedError } from 'typeorm';
import {
  ADMIN_REGISTER_MESSAGE,
  AuthService,
  FORGOT_MESSAGE,
  INVALID_CREDENTIALS,
  INVALID_OTP,
  MAX_OTP_ATTEMPTS,
  OTP_RESEND_COOLDOWN_MS,
  REFRESH_REUSE_GRACE_MS,
  REGISTER_MESSAGE,
} from './auth.service';
import { RefreshToken } from './entities/refresh-token.entity';
import { UserOtp } from '../users/entities/user-otp.entity';
import {
  AdminRequestStatus,
  User,
  UserRole,
} from '../users/entities/user.entity';

// Hand-rolled fakes (testing skill). Query-builder UPDATE/DELETE calls take
// their `.raw` rows from a queue, in call order.

type Qb = Record<'update' | 'set' | 'where' | 'returning' | 'execute', jest.Mock>;

function fakeQb(rawQueue: unknown[][]): Qb {
  const qb: Qb = {
    update: jest.fn(),
    set: jest.fn(),
    where: jest.fn(),
    returning: jest.fn(),
    execute: jest.fn(async () => ({ raw: rawQueue.shift() ?? [] })),
  };
  for (const step of ['update', 'set', 'where', 'returning'] as const) {
    qb[step].mockReturnValue(qb);
  }
  return qb;
}

/** `n` rows matched (1 = the conditional UPDATE won, 0 = it didn't). */
const matched = (n: number) => Array.from({ length: n }, () => ({ id: 'x' }));

const dbError = (code: string, constraint: string) =>
  Object.assign(new QueryFailedError('q', [], new Error('x')), {
    driverError: { code, constraint },
  });

const roles = {
  [UserRole.ADMIN]: { id: 1, name: UserRole.ADMIN },
  [UserRole.USER]: { id: 2, name: UserRole.USER },
  [UserRole.SUPER_ADMIN]: { id: 3, name: UserRole.SUPER_ADMIN },
};

let password: string;
let passwordHash: string;
beforeAll(async () => {
  password = 'Password123!';
  passwordHash = await bcrypt.hash(password, 4);
});

const makeUser = (overrides: Partial<User> = {}): User =>
  ({
    id: 'user-id',
    email: 'user@example.com',
    name: 'Test User',
    role: roles[UserRole.USER],
    passwordHash,
    emailVerifiedAt: new Date(),
    isActive: true,
    adminRequestStatus: null,
    ...overrides,
  }) as User;

function build(opts: { otpQueue?: unknown[][]; tokenQueue?: unknown[][] } = {}) {
  const users = {
    findOneBy: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    create: jest.fn((v) => v),
    save: jest.fn(async (v) => ({ ...v, id: 'new-user-id' })),
  };
  const tokenQb = fakeQb(opts.tokenQueue ?? []);
  const refreshTokens = {
    qb: tokenQb,
    createQueryBuilder: jest.fn(() => tokenQb),
    findOneBy: jest.fn().mockResolvedValue(null),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    create: jest.fn((v) => v),
    save: jest.fn(async (v) => ({ ...v, id: 'new-token-id' })),
  };
  const otpQb = fakeQb(opts.otpQueue ?? [matched(1), matched(1)]);
  const otps = {
    qb: otpQb,
    createQueryBuilder: jest.fn(() => otpQb),
    findOne: jest.fn().mockResolvedValue(null),
    update: jest.fn().mockResolvedValue(undefined),
    create: jest.fn((v) => v),
    save: jest.fn(async (v) => v),
  };
  const rolesRepo = {
    findOneBy: jest.fn(
      async (where: { id?: number; name?: string }) =>
        Object.values(roles).find(
          (r) => r.id === where.id || r.name === where.name,
        ) ?? null,
    ),
  };
  const jwt = { signAsync: jest.fn().mockResolvedValue('access-token') };
  const mail = {
    sendOtp: jest.fn().mockResolvedValue(undefined),
    sendPasswordChanged: jest.fn().mockResolvedValue(undefined),
  };
  const repoFor = new Map<unknown, unknown>([
    [User, users],
    [RefreshToken, refreshTokens],
    [UserOtp, otps],
  ]);
  const manager = { getRepository: (entity: unknown) => repoFor.get(entity) };
  const dataSource = {
    manager,
    transaction: jest.fn(async (fn: (m: typeof manager) => unknown) => fn(manager)),
  };
  const service = new AuthService(
    users as never,
    refreshTokens as never,
    otps as never,
    rolesRepo as never,
    jwt as never,
    mail as never,
    dataSource as never,
  );
  return { service, users, refreshTokens, otps, jwt, mail, dataSource };
}

describe('AuthService', () => {
  describe('login', () => {
    it('returns a session without internal ids, and stores session metadata', async () => {
      const { service, users, refreshTokens, jwt } = build();
      users.findOneBy.mockResolvedValue(makeUser());

      const result = await service.login('user@example.com', password, {
        ip: '10.0.0.1',
        userAgent: 'x'.repeat(300),
      });

      expect(Object.keys(result).sort()).toEqual([
        'accessToken',
        'refreshToken',
        'user',
      ]);
      // No email in the JWT payload.
      expect(jwt.signAsync).toHaveBeenCalledWith({
        sub: 'user-id',
        role: UserRole.USER,
      });
      const saved = refreshTokens.save.mock.calls[0][0];
      expect(saved.ip).toBe('10.0.0.1');
      expect(saved.userAgent).toHaveLength(255);
    });

    it('gives the same answer for an unknown email and a wrong password', async () => {
      const unknown = build();
      const wrong = build();
      wrong.users.findOneBy.mockResolvedValue(makeUser());

      for (const attempt of [
        () => unknown.service.login('nobody@example.com', password),
        () => wrong.service.login('user@example.com', 'WrongPassword1!'),
      ]) {
        const err = await attempt().catch((e: unknown) => e);
        expect(err).toBeInstanceOf(UnauthorizedException);
        expect((err as Error).message).toBe(INVALID_CREDENTIALS);
      }
    });

    it.each([
      ['unverified', { emailVerifiedAt: null }, UnauthorizedException],
      ['suspended', { isActive: false }, ForbiddenException],
      [
        'waiting for admin approval',
        { adminRequestStatus: AdminRequestStatus.PENDING },
        ForbiddenException,
      ],
    ])('refuses a %s account after a correct password', async (_, overrides, error) => {
      const { service, users, refreshTokens } = build();
      users.findOneBy.mockResolvedValue(makeUser(overrides as Partial<User>));

      await expect(service.login('user@example.com', password)).rejects.toBeInstanceOf(
        error,
      );
      expect(refreshTokens.save).not.toHaveBeenCalled();
    });

    it('lets a REJECTED admin request log in as a plain USER', async () => {
      const { service, users } = build();
      users.findOneBy.mockResolvedValue(
        makeUser({ adminRequestStatus: AdminRequestStatus.REJECTED }),
      );

      const result = await service.login('user@example.com', password);
      expect(result.user.role).toBe(UserRole.USER);
    });
  });

  // docs/auth.md C1, M2, M4.
  describe('registerUser', () => {
    it('stores an admin request as USER + PENDING, unverified, and sends a code', async () => {
      const { service, users, mail } = build();

      await expect(
        service.registerUser('a@example.com', password, 'A', roles.ADMIN.id),
      ).resolves.toEqual({ message: ADMIN_REGISTER_MESSAGE });

      const saved = users.save.mock.calls[0][0];
      expect(saved.role).toEqual(roles[UserRole.USER]);
      expect(saved.adminRequestStatus).toBe(AdminRequestStatus.PENDING);
      expect(saved.emailVerifiedAt).toBeNull();
      expect(mail.sendOtp).toHaveBeenCalledWith(
        'a@example.com',
        'EMAIL_VERIFY',
        expect.stringMatching(/^\d{6}$/),
      );
    });

    it('stores a plain registration as USER with no admin status', async () => {
      const { service, users } = build();

      await expect(
        service.registerUser('u@example.com', password, 'U', roles.USER.id),
      ).resolves.toEqual({ message: REGISTER_MESSAGE });
      const saved = users.save.mock.calls[0][0];
      expect(saved.role).toEqual(roles[UserRole.USER]);
      expect(saved.adminRequestStatus).toBeNull();
    });

    it('answers an existing verified email exactly like a new one, changing nothing', async () => {
      const { service, users, mail, otps } = build();
      users.findOneBy.mockResolvedValue(makeUser());

      await expect(
        service.registerUser('user@example.com', password, 'X', roles.USER.id),
      ).resolves.toEqual({ message: REGISTER_MESSAGE });
      expect(users.save).not.toHaveBeenCalled();
      expect(otps.save).not.toHaveBeenCalled();
      expect(mail.sendOtp).not.toHaveBeenCalled();
    });

    it('re-sends a code to an existing unverified email, same response', async () => {
      const { service, users, mail } = build();
      users.findOneBy.mockResolvedValue(makeUser({ emailVerifiedAt: null }));

      await expect(
        service.registerUser('user@example.com', password, 'X', roles.USER.id),
      ).resolves.toEqual({ message: REGISTER_MESSAGE });
      expect(users.save).not.toHaveBeenCalled();
      expect(mail.sendOtp).toHaveBeenCalledTimes(1);
    });

    it('treats losing a concurrent registration race as "already registered"', async () => {
      const { service, users, mail } = build();
      users.save.mockRejectedValueOnce(dbError('23505', 'users_email_uk'));

      await expect(
        service.registerUser('u@example.com', password, 'U', roles.USER.id),
      ).resolves.toEqual({ message: REGISTER_MESSAGE });
      expect(mail.sendOtp).not.toHaveBeenCalled();
    });

    it('rejects SUPER_ADMIN at registration', async () => {
      const { service, users } = build();

      await expect(
        service.registerUser('s@example.com', password, 'S', roles.SUPER_ADMIN.id),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(users.save).not.toHaveBeenCalled();
    });
  });

  // docs/auth.md M2: only verified admin requests can be reviewed.
  describe('admin requests', () => {
    const superAdmin = makeUser({ id: 'super-id', role: roles[UserRole.SUPER_ADMIN] as never });
    const withUsers = (target: User) => {
      const ctx = build();
      ctx.users.findOneBy.mockImplementation(async ({ id }: { id: string }) =>
        id === superAdmin.id ? superAdmin : id === target.id ? target : null,
      );
      return ctx;
    };

    it('lists only verified pending requests', async () => {
      const { service, users } = withUsers(makeUser());

      await service.listAdminRequests(superAdmin.id);

      expect(users.find.mock.calls[0][0].where).toEqual({
        adminRequestStatus: AdminRequestStatus.PENDING,
        emailVerifiedAt: expect.anything(),
      });
    });

    it('cannot approve an unverified request (404)', async () => {
      const target = makeUser({
        emailVerifiedAt: null,
        adminRequestStatus: AdminRequestStatus.PENDING,
      });
      const { service, users } = withUsers(target);

      await expect(
        service.approveAdminRequest(superAdmin.id, target.id),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(users.update).not.toHaveBeenCalled();
    });

    it('approves only while still PENDING (conditional update)', async () => {
      const target = makeUser({ adminRequestStatus: AdminRequestStatus.PENDING });
      const { service, users } = withUsers(target);

      await service.approveAdminRequest(superAdmin.id, target.id);
      expect(users.update).toHaveBeenCalledWith(
        { id: target.id, adminRequestStatus: AdminRequestStatus.PENDING },
        expect.objectContaining({
          role: roles[UserRole.ADMIN],
          adminRequestStatus: AdminRequestStatus.APPROVED,
        }),
      );

      users.update.mockResolvedValueOnce({ affected: 0 }); // a reject won the race
      await expect(
        service.approveAdminRequest(superAdmin.id, target.id),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejecting leaves the role untouched (stays USER)', async () => {
      const target = makeUser({ adminRequestStatus: AdminRequestStatus.PENDING });
      const { service, users } = withUsers(target);

      await service.rejectAdminRequest(superAdmin.id, target.id);
      const [, changes] = users.update.mock.calls[0];
      expect(changes.adminRequestStatus).toBe(AdminRequestStatus.REJECTED);
      expect(changes).not.toHaveProperty('role');
    });
  });

  // docs/auth.md H1 + transactions.
  describe('OTP verification', () => {
    const code = '123456';
    let liveOtp: { id: string; codeHash: string };
    beforeAll(async () => {
      liveOtp = { id: 'otp-id', codeHash: await bcrypt.hash(code, 4) };
    });
    const unverified = () => makeUser({ emailVerifiedAt: null });

    it('reserves an attempt, then consumes the code and verifies in one transaction', async () => {
      const { service, users, otps, dataSource } = build();
      users.findOneBy.mockResolvedValue(unverified());
      otps.findOne.mockResolvedValue(liveOtp);

      await expect(service.verifyEmail('user@example.com', code)).resolves.toEqual({
        message: 'Email verified successfully',
      });

      expect(otps.qb.where.mock.calls[0]).toEqual([
        'id = :id AND attempts < :max AND used_at IS NULL AND expires_at > now()',
        { id: 'otp-id', max: MAX_OTP_ATTEMPTS },
      ]);
      expect(otps.qb.where.mock.calls[1]).toEqual([
        'id = :id AND used_at IS NULL',
        { id: 'otp-id' },
      ]);
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(users.update).toHaveBeenCalledWith('user-id', {
        emailVerifiedAt: expect.any(Date),
      });
    });

    it('rejects even the right code once the cap is reached or the code expired', async () => {
      const { service, users, otps } = build({ otpQueue: [matched(0)] });
      users.findOneBy.mockResolvedValue(unverified());
      otps.findOne.mockResolvedValue(liveOtp);

      await expect(service.verifyEmail('user@example.com', code)).rejects.toThrow(
        INVALID_OTP,
      );
      expect(otps.qb.execute).toHaveBeenCalledTimes(1);
      expect(users.update).not.toHaveBeenCalled();
    });

    it('counts a wrong code outside any transaction, so it is never rolled back', async () => {
      const { service, users, otps, dataSource } = build();
      users.findOneBy.mockResolvedValue(unverified());
      otps.findOne.mockResolvedValue(liveOtp);

      await expect(service.verifyEmail('user@example.com', '000000')).rejects.toThrow(
        INVALID_OTP,
      );
      expect(otps.qb.execute).toHaveBeenCalledTimes(1);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('rejects the loser when two requests consume the same code', async () => {
      const { service, users, otps } = build({ otpQueue: [matched(1), matched(0)] });
      users.findOneBy.mockResolvedValue(unverified());
      otps.findOne.mockResolvedValue(liveOtp);

      await expect(service.verifyEmail('user@example.com', code)).rejects.toThrow(
        INVALID_OTP,
      );
      expect(users.update).not.toHaveBeenCalled();
    });

    it('gives an unknown email the same error as a wrong code', async () => {
      const { service } = build();

      await expect(service.verifyEmail('nobody@example.com', code)).rejects.toThrow(
        INVALID_OTP,
      );
      await expect(
        service.resetPassword('nobody@example.com', code, 'NewPassword123!'),
      ).rejects.toThrow(INVALID_OTP);
    });

    it('resets the password: code, hash and sessions in one transaction, then a notice', async () => {
      const { service, users, otps, refreshTokens, dataSource, mail } = build();
      users.findOneBy.mockResolvedValue(makeUser());
      otps.findOne.mockResolvedValue(liveOtp);

      await service.resetPassword('user@example.com', code, 'NewPassword123!');

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(users.update).toHaveBeenCalledWith('user-id', {
        passwordHash: expect.any(String),
      });
      expect(refreshTokens.update).toHaveBeenCalledWith(
        { userId: 'user-id', revokedAt: IsNull() },
        { revokedAt: expect.any(Date) },
      );
      expect(mail.sendPasswordChanged).toHaveBeenCalledWith('user@example.com');
    });

    it('a rejected reset code changes nothing', async () => {
      const { service, users, otps, refreshTokens } = build({ otpQueue: [matched(0)] });
      users.findOneBy.mockResolvedValue(makeUser());
      otps.findOne.mockResolvedValue(liveOtp);

      await expect(
        service.resetPassword('user@example.com', code, 'NewPassword123!'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(users.update).not.toHaveBeenCalled();
      expect(refreshTokens.update).not.toHaveBeenCalled();
    });
  });

  describe('OTP issuing', () => {
    it('does not send another code inside the resend cooldown', async () => {
      const { service, users, otps, mail } = build();
      users.findOneBy.mockResolvedValue(makeUser({ emailVerifiedAt: null }));
      otps.findOne.mockResolvedValue({
        expiresAt: new Date(Date.now() + 60_000),
        lastSentAt: new Date(),
      });

      await service.resendOtp('user@example.com');
      expect(otps.save).not.toHaveBeenCalled();
      expect(mail.sendOtp).not.toHaveBeenCalled();
    });

    it('sends a new code once the cooldown has passed', async () => {
      const { service, users, otps, mail } = build();
      users.findOneBy.mockResolvedValue(makeUser({ emailVerifiedAt: null }));
      otps.findOne.mockResolvedValue({
        expiresAt: new Date(Date.now() + 60_000),
        lastSentAt: new Date(Date.now() - OTP_RESEND_COOLDOWN_MS - 1),
      });

      await service.resendOtp('user@example.com');
      expect(otps.update).toHaveBeenCalled(); // previous code invalidated
      expect(otps.save).toHaveBeenCalled();
      expect(mail.sendOtp).toHaveBeenCalledTimes(1);
    });

    it('does not fail the request when mail delivery fails', async () => {
      const { service, users, mail } = build();
      users.findOneBy.mockResolvedValue(makeUser());
      mail.sendOtp.mockRejectedValueOnce(new Error('smtp down'));

      await expect(service.forgotPassword('user@example.com')).resolves.toEqual({
        message: FORGOT_MESSAGE,
      });
    });

    it('answers forgot-password identically for unknown emails', async () => {
      const { service, mail } = build();

      await expect(service.forgotPassword('nobody@example.com')).resolves.toEqual({
        message: FORGOT_MESSAGE,
      });
      expect(mail.sendOtp).not.toHaveBeenCalled();
    });

    it('is a quiet no-op when a concurrent request issued the live code', async () => {
      const { service, users, otps, mail } = build();
      users.findOneBy.mockResolvedValue(makeUser({ emailVerifiedAt: null }));
      otps.save.mockRejectedValueOnce(dbError('23505', 'user_otps_live_uk'));

      await service.resendOtp('user@example.com');
      expect(mail.sendOtp).not.toHaveBeenCalled();
    });

    it('still surfaces other database errors', async () => {
      const { service, users, otps } = build();
      users.findOneBy.mockResolvedValue(makeUser({ emailVerifiedAt: null }));
      otps.save.mockRejectedValueOnce(dbError('23503', 'user_otps_user_id_fkey'));

      await expect(service.resendOtp('user@example.com')).rejects.toBeInstanceOf(
        QueryFailedError,
      );
    });
  });

  // docs/auth.md M1.
  describe('refresh', () => {
    it('rotates: revokes the old token conditionally and links it to the new one', async () => {
      const { service, users, refreshTokens } = build({
        tokenQueue: [[{ id: 'old-id', user_id: 'user-id' }]],
      });
      users.findOneBy.mockResolvedValue(makeUser());

      const result = await service.refresh('raw-token');

      expect(refreshTokens.qb.where.mock.calls[0][0]).toBe(
        'token_hash = :tokenHash AND revoked_at IS NULL AND expires_at > now()',
      );
      expect(refreshTokens.update).toHaveBeenCalledWith('old-id', {
        replacedById: 'new-token-id',
      });
      expect(Object.keys(result).sort()).toEqual(['accessToken', 'refreshToken', 'user']);
    });

    it('revokes every session when an already-rotated token is replayed', async () => {
      const { service, refreshTokens } = build({ tokenQueue: [[]] });
      refreshTokens.findOneBy.mockResolvedValue({
        id: 'old-id',
        userId: 'user-id',
        replacedById: 'newer-id',
        revokedAt: new Date(Date.now() - REFRESH_REUSE_GRACE_MS - 1),
      });

      await expect(service.refresh('raw-token')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(refreshTokens.update).toHaveBeenCalledWith(
        { userId: 'user-id', revokedAt: IsNull() },
        { revokedAt: expect.any(Date) },
      );
    });

    it('treats a replay right after rotation as a client race: 401, sessions kept', async () => {
      const { service, refreshTokens } = build({ tokenQueue: [[]] });
      refreshTokens.findOneBy.mockResolvedValue({
        id: 'old-id',
        userId: 'user-id',
        replacedById: 'newer-id',
        revokedAt: new Date(),
      });

      await expect(service.refresh('raw-token')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(refreshTokens.update).not.toHaveBeenCalled();
    });

    it('just refuses a logged-out, expired or unknown token', async () => {
      const { service, refreshTokens } = build({ tokenQueue: [[]] });
      refreshTokens.findOneBy.mockResolvedValue({
        id: 'old-id',
        userId: 'user-id',
        replacedById: null,
      });

      await expect(service.refresh('raw-token')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(refreshTokens.update).not.toHaveBeenCalled();
    });

    it.each([
      ['suspended', { isActive: false }],
      ['unverified', { emailVerifiedAt: null }],
      ['pending admin request', { adminRequestStatus: AdminRequestStatus.PENDING }],
    ])('refuses a %s account', async (_, overrides) => {
      const { service, users, jwt } = build({
        tokenQueue: [[{ id: 'old-id', user_id: 'user-id' }]],
      });
      users.findOneBy.mockResolvedValue(makeUser(overrides as Partial<User>));

      await expect(service.refresh('raw-token')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(jwt.signAsync).not.toHaveBeenCalled();
    });
  });

  describe('sessions and passwords', () => {
    it('logout only revokes a token that belongs to the caller', async () => {
      const { service, refreshTokens } = build();

      await expect(service.logout('user-id', 'raw-token')).resolves.toEqual({
        message: 'Logout successful',
      });
      expect(refreshTokens.update).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-id', revokedAt: IsNull() }),
        { revokedAt: expect.any(Date) },
      );
    });

    it('logout-all revokes every live token of the caller', async () => {
      const { service, refreshTokens } = build();

      await service.logoutAll('user-id');
      expect(refreshTokens.update).toHaveBeenCalledWith(
        { userId: 'user-id', revokedAt: IsNull() },
        { revokedAt: expect.any(Date) },
      );
    });

    it('changes the password and signs out everywhere in one transaction', async () => {
      const { service, users, refreshTokens, dataSource, mail } = build();
      users.findOneBy.mockResolvedValue(makeUser());

      await service.changePassword('user-id', password, 'NewPassword123!');

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(users.update).toHaveBeenCalledWith('user-id', {
        passwordHash: expect.any(String),
      });
      expect(refreshTokens.update).toHaveBeenCalled();
      expect(mail.sendPasswordChanged).toHaveBeenCalledTimes(1);
    });

    it('refuses a wrong current password and changes nothing', async () => {
      const { service, users, dataSource } = build();
      users.findOneBy.mockResolvedValue(makeUser());

      await expect(
        service.changePassword('user-id', 'WrongPassword1!', 'NewPassword123!'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });
});
