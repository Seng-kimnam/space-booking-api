import {
  ExecutionContext,
  ForbiddenException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { DataSource, EntityManager } from 'typeorm';
import { AuthGuard } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { MailService } from '../auth/mail.service';
import { BookingLifecycleService } from '../bookings/services/booking-lifecycle.service';
import { BookingQrService } from '../bookings/services/booking-qr.service';
import { NotificationType } from './enums';
import { NotificationsService } from '../notifications/services/notifications.service';
import { RolesGuard } from './guards/roles.guard';

// Logging added to services that had none. Each test also checks that
// secrets (email, OTP, token) never reach the log lines.

let spies: Record<'log' | 'warn' | 'error' | 'debug', jest.SpyInstance>;
const allLines = () =>
  Object.values(spies)
    .flatMap((s) => s.mock.calls.map(([m]) => String(m)))
    .join('\n');

beforeEach(() => {
  spies = {
    log: jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined),
    warn: jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined),
    error: jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined),
    debug: jest
      .spyOn(Logger.prototype, 'debug')
      .mockImplementation(() => undefined),
  };
});
afterEach(() => jest.restoreAllMocks());

const httpContext = (request: object) =>
  ({
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  }) as unknown as ExecutionContext;

describe('MailService logging', () => {
  const config = {
    getOrThrow: (key: string) =>
      ({
        'mail.host': 'localhost',
        'mail.port': 1025,
        'mail.from': 'no-reply@x',
        'mail.secure': false,
        'mail.requireTls': false,
      })[key],
  } as unknown as ConfigService;
  const withTransport = (sendMail: jest.Mock) => {
    const svc = new MailService(config);
    // Replace the real SMTP transport; the test never opens a connection.
    (svc as unknown as { transporter: { sendMail: jest.Mock } }).transporter = {
      sendMail,
    };
    return svc;
  };

  it('logs a sent OTP email by purpose only', async () => {
    await withTransport(jest.fn().mockResolvedValue({})).sendOtp(
      'alice@example.com',
      'EMAIL_VERIFY',
      '123456',
    );
    expect(spies.log).toHaveBeenCalledWith(
      'OTP email sent: purpose=EMAIL_VERIFY',
    );
    expect(allLines()).not.toMatch(/alice@example\.com|123456/);
  });

  it('logs an SMTP failure with code and response code, then rethrows', async () => {
    const smtpError = Object.assign(
      new Error('550 5.1.1 <alice@example.com>: Recipient address rejected'),
      { code: 'EENVELOPE', responseCode: 550, command: 'RCPT TO' },
    );
    await expect(
      withTransport(jest.fn().mockRejectedValue(smtpError)).sendOtp(
        'alice@example.com',
        'PASSWORD_RESET',
        '654321',
      ),
    ).rejects.toBe(smtpError);
    expect(spies.error).toHaveBeenCalledWith(
      'OTP email not sent: purpose=PASSWORD_RESET code=EENVELOPE smtp=550 command=RCPT TO',
    );
    // The SMTP text echoes the address: it must not be logged.
    expect(allLines()).not.toMatch(/alice@example\.com|654321/);
  });
});

describe('AuthService logging', () => {
  // Minimal fakes: only what each path touches.
  const service = (deps: {
    users?: object;
    refreshTokens?: object;
    dataSource?: object;
  }) =>
    new AuthService(
      (deps.users ?? {}) as never,
      (deps.refreshTokens ?? {}) as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      (deps.dataSource ?? {}) as never,
    );

  it('warns on a failed login with the user id only, never the email or password', async () => {
    const svc = service({ users: { findOneBy: jest.fn().mockResolvedValue(null) } });

    await expect(svc.login('alice@example.com', 'S3cret-Passw0rd')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(spies.warn).toHaveBeenCalledWith('Login failed: user=unknown');
    expect(allLines()).not.toMatch(/alice@example\.com|S3cret-Passw0rd/);
  });

  it('warns on refresh-token reuse with ids only, never the token', async () => {
    const qb = {
      update: () => qb,
      set: () => qb,
      where: () => qb,
      returning: () => qb,
      execute: async () => ({ raw: [] }),
    };
    const refreshTokens = {
      createQueryBuilder: () => qb,
      findOneBy: jest
        .fn()
        // Rotated an hour ago: outside the grace window, so this is reuse.
        .mockResolvedValue({
          id: 'rt-1',
          userId: 'u-1',
          replacedById: 'rt-2',
          revokedAt: new Date(Date.now() - 3_600_000),
        }),
      update: jest.fn().mockResolvedValue({ affected: 3 }),
    };
    const manager = { getRepository: () => refreshTokens };
    const svc = service({
      refreshTokens,
      dataSource: { manager, transaction: (fn: (m: object) => unknown) => fn(manager) },
    });

    await expect(svc.refresh('leaked.refresh.value')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(spies.warn).toHaveBeenCalledWith(
      'Refresh token reuse detected: user=u-1 token=rt-1 revokedSessions=3',
    );
    expect(allLines()).not.toContain('leaked.refresh.value');
  });
});

describe('AuthGuard logging', () => {
  const guard = (verify: jest.Mock) =>
    new AuthGuard({ verifyAsync: verify } as unknown as JwtService);
  const request = (authorization?: string) => ({
    method: 'GET',
    path: '/api/v1/bookings',
    headers: authorization ? { authorization } : {},
  });

  it('debug-logs a missing token', async () => {
    await expect(
      guard(jest.fn()).canActivate(httpContext(request())),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(spies.debug).toHaveBeenCalledWith(
      '401 GET /api/v1/bookings: no bearer token',
    );
  });

  it('debug-logs the JWT error name, never the token', async () => {
    const expired = Object.assign(new Error('jwt expired'), {
      name: 'TokenExpiredError',
    });
    await expect(
      guard(jest.fn().mockRejectedValue(expired)).canActivate(
        httpContext(request('Bearer secret.jwt.value')),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(spies.debug).toHaveBeenCalledWith(
      '401 GET /api/v1/bookings: TokenExpiredError',
    );
    expect(allLines()).not.toContain('secret.jwt.value');
    expect(spies.warn).not.toHaveBeenCalled();
  });
});

describe('RolesGuard logging', () => {
  const guard = new RolesGuard({
    getAllAndOverride: () => ['ADMIN'],
  } as unknown as Reflector);

  it('warns on a 403 with user, role and required roles', () => {
    expect(() =>
      guard.canActivate(
        httpContext({
          method: 'POST',
          path: '/api/v1/admin/roles',
          user: { sub: 'u1', role: 'USER' },
        }),
      ),
    ).toThrow(ForbiddenException);
    expect(spies.warn).toHaveBeenCalledWith(
      '403 POST /api/v1/admin/roles: user=u1 role=USER required=ADMIN',
    );
  });

  it('logs nothing when access is allowed', () => {
    guard.canActivate(httpContext({ user: { sub: 'a1', role: 'ADMIN' } }));
    expect(allLines()).toBe('');
  });
});

describe('BookingLifecycleService logging', () => {
  const booking = (id: string, groupId: string | null, userId: string) => ({
    id,
    groupId,
    userId,
    seat: { place: {} },
  });

  function setup(expirable: object[], overdue: object[] = []) {
    const manager = {} as EntityManager;
    const svc = new BookingLifecycleService(
      {
        transaction: (fn: (m: EntityManager) => unknown) => fn(manager),
      } as unknown as DataSource,
      {
        claimExpirable: jest.fn().mockResolvedValue(expirable),
        claimOverdue: jest.fn().mockResolvedValue(overdue),
        updateFields: jest.fn(),
      } as never,
      { alertPayload: () => ({}), record: jest.fn() } as never,
      { revokeLive: jest.fn() } as never,
      { skipPending: jest.fn(), schedule: jest.fn() } as never,
      { incrementNoShow: jest.fn() } as never,
    );
    return svc;
  }

  it('logs one line per expired group with booking and user ids', async () => {
    const svc = setup([
      booking('b1', 'g1', 'u1'),
      booking('b2', 'g1', 'u1'),
      booking('b3', null, 'u2'),
    ]);
    await expect(svc.expireDue(new Date())).resolves.toBe(3);
    expect(spies.log.mock.calls.map(([m]) => m)).toEqual([
      'Booking expired (no-show): group=g1 bookings=b1,b2 user=u1',
      'Booking expired (no-show): group=b3 bookings=b3 user=u2',
    ]);
  });

  it('logs overdue checkouts, and nothing when no booking is due', async () => {
    await setup([], [booking('b9', null, 'u9')]).markOverdue(new Date());
    expect(spies.log).toHaveBeenCalledWith(
      'Booking checkout overdue: group=b9 bookings=b9 user=u9',
    );
    spies.log.mockClear();
    await expect(setup([]).expireDue(new Date())).resolves.toBe(0);
    expect(spies.log).not.toHaveBeenCalled();
  });
});

describe('BookingQrService.revokeLive', () => {
  it('returns how many tokens were revoked, and does not log (callers do)', async () => {
    const update = jest.fn().mockResolvedValue({ affected: 2 });
    const manager = {
      getRepository: () => ({ update }),
    } as unknown as EntityManager;
    const svc = new BookingQrService({} as never, {} as never, {} as never);
    await expect(svc.revokeLive(manager, ['b1', 'b2'])).resolves.toBe(2);
    await expect(svc.revokeLive(manager, [])).resolves.toBe(0);
    expect(allLines()).toBe('');
  });
});

describe('NotificationsService logging', () => {
  const repo = {
    insertIgnoringDuplicates: jest.fn(),
    reschedulePending: jest.fn(),
    skipPending: jest.fn(),
  };
  const svc = new NotificationsService(repo as never);
  const manager = {} as EntityManager;
  const at = new Date('2026-11-10T03:00:00.000Z');

  it('debug-logs queued, rescheduled and skipped alerts without payloads', async () => {
    await svc.schedule(manager, [
      {
        userId: 'u1',
        bookingId: 'b1',
        type: NotificationType.BOOKING_CONFIRMED,
        scheduledAt: at,
        payload: { placeName: 'Secret Library' } as never,
      },
    ]);
    await svc.reschedule(
      manager,
      ['b1'],
      NotificationType.CHECKOUT_REMINDER,
      at,
    );
    await svc.skipPending(manager, ['b1']);

    expect(spies.debug.mock.calls.map(([m]) => m)).toEqual([
      'Alerts queued: bookings=b1 BOOKING_CONFIRMED@2026-11-10T03:00:00.000Z',
      'Alert rescheduled: CHECKOUT_REMINDER -> 2026-11-10T03:00:00.000Z bookings=b1',
      'Pending alerts skipped: types=all bookings=b1',
    ]);
    expect(allLines()).not.toContain('Secret Library');
    expect(spies.log).not.toHaveBeenCalled();
  });

  it('logs nothing for empty calls', async () => {
    await svc.schedule(manager, []);
    await svc.skipPending(manager, []);
    expect(allLines()).toBe('');
  });
});
