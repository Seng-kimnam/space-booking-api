import { Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { TelegramAccountsService } from '../telegram/services/telegram-accounts.service';
import {
  TelegramApiError,
  TelegramBotClient,
} from '../telegram/telegram-bot.client';
import {
  NotificationChannel,
  NotificationStatus,
  NotificationType,
} from '../common/enums';
import {
  NotificationChannelStrategy,
  RateLimitedError,
  RecipientUnreachableError,
} from './channels/notification-channel.strategy';
import {
  escapeTelegramHtml,
  formatForTelegram,
  TelegramChannel,
} from './channels/telegram.channel';
import { Notification } from './entities/notification.entity';
import { NotificationsRepository } from './repositories/notifications.repository';
import {
  groupForDelivery,
  LEASE_MS,
  MAX_ATTEMPTS,
  mergePayloads,
  nextAttemptAt,
  NotificationDispatcher,
} from './services/notification-dispatcher.service';
import { NotificationsService } from './services/notifications.service';
import { renderNotification } from './templates/notification-templates';

const payload = (labels: string[], groupId = 'g1') => ({
  groupId,
  placeName: 'Demo Library',
  timezone: 'Asia/Phnom_Penh',
  seatLabels: labels,
  startAt: '2026-11-09T03:00:00.000Z',
  endAt: '2026-11-09T04:00:00.000Z',
  checkinDeadline: '2026-11-09T03:15:00.000Z',
});

function row(overrides: Partial<Notification> = {}): Notification {
  return Object.assign(new Notification(), {
    id: Math.random().toString(36).slice(2),
    userId: 'u1',
    bookingId: 'b1',
    channel: NotificationChannel.TELEGRAM,
    type: NotificationType.LATE_CHECKIN,
    status: NotificationStatus.PENDING,
    attempts: 0,
    payload: payload(['A1']),
    ...overrides,
  });
}

describe('notification templates', () => {
  it('renders times in the place timezone', () => {
    const msg = renderNotification(
      NotificationType.LATE_CHECKIN,
      payload(['A1']),
    );
    expect(msg?.body).toContain('started at 10:00');
    expect(msg?.body).toContain('before 10:15');
  });

  it('lists every seat of a multi-seat booking', () => {
    const msg = renderNotification(
      NotificationType.BOOKING_CONFIRMED,
      payload(['A1', 'A2']),
    );
    expect(msg?.body).toContain('seats A1, A2');
  });

  it.each([
    NotificationType.BOOKING_CONFIRMED,
    NotificationType.BOOKING_CANCELLED,
    NotificationType.LATE_CHECKIN,
    NotificationType.CHECKOUT_REMINDER,
    NotificationType.BOOKING_EXPIRED,
    NotificationType.FORGOTTEN_CHECKOUT,
    NotificationType.BOOKING_MODIFIED,
    NotificationType.BOOKING_EXTENDED,
    NotificationType.CHECKED_IN,
    NotificationType.CHECKED_OUT,
  ])('has a template for %s', (type) => {
    expect(renderNotification(type, payload(['A1']))).not.toBeNull();
  });

  it('shows the old and new time when a booking is modified', () => {
    const msg = renderNotification(NotificationType.BOOKING_MODIFIED, {
      ...payload(['A1']),
      previousStartAt: '2026-11-09T02:00:00.000Z',
      previousEndAt: '2026-11-09T03:00:00.000Z',
    });
    expect(msg?.body).toContain('Was: Mon, 9 Nov 2026, 09:00 - 10:00');
    expect(msg?.body).toContain('Now: Mon, 9 Nov 2026, 10:00 - 11:00');
  });

  it('shows the previous end when a booking is extended', () => {
    const msg = renderNotification(NotificationType.BOOKING_EXTENDED, {
      ...payload(['A1']),
      previousEndAt: '2026-11-09T03:30:00.000Z',
    });
    expect(msg?.body).toContain('now ends at 11:00 (was 10:30)');
  });

  it('has no template for auth emails (owned by auth)', () => {
    expect(
      renderNotification(NotificationType.EMAIL_VERIFY_OTP, payload(['A1'])),
    ).toBeNull();
  });

  it('escapes HTML for Telegram', () => {
    expect(escapeTelegramHtml('<b>&')).toBe('&lt;b&gt;&amp;');
    expect(formatForTelegram({ title: 'T<', body: 'B>' })).toBe(
      '<b>T&lt;</b>\nB&gt;',
    );
  });
});

describe('NotificationsService.channelFor', () => {
  const service = new NotificationsService({} as NotificationsRepository);

  it('sends auth OTPs by email and booking alerts by Telegram', () => {
    expect(service.channelFor(NotificationType.PASSWORD_RESET_OTP)).toBe(
      NotificationChannel.EMAIL,
    );
    expect(service.channelFor(NotificationType.LATE_CHECKIN)).toBe(
      NotificationChannel.TELEGRAM,
    );
  });
});

describe('dispatcher helpers', () => {
  it('groups the rows of one multi-seat booking into one delivery', () => {
    const batches = groupForDelivery([
      row({ payload: payload(['A1'], 'g1') }),
      row({ payload: payload(['A2'], 'g1') }),
      row({ payload: payload(['B1'], 'g2') }),
      row({
        type: NotificationType.BOOKING_CONFIRMED,
        payload: payload(['A1'], 'g1'),
      }),
    ]);
    expect(batches.map((b) => b.length).sort()).toEqual([1, 1, 2]);
  });

  it('merges and sorts seat labels', () => {
    expect(
      mergePayloads([
        row({ payload: payload(['A2']) }),
        row({ payload: payload(['A1']) }),
      ]).seatLabels,
    ).toEqual(['A1', 'A2']);
  });

  it('backs off exponentially, capped at an hour', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    expect(nextAttemptAt(now, 1).getTime() - now.getTime()).toBe(60_000);
    expect(nextAttemptAt(now, 3).getTime() - now.getTime()).toBe(4 * 60_000);
    expect(nextAttemptAt(now, 20).getTime() - now.getTime()).toBe(60 * 60_000);
  });
});

describe('NotificationDispatcher', () => {
  const manager = {} as EntityManager;
  const dataSource = {
    transaction: (fn: (m: EntityManager) => Promise<unknown>) => fn(manager),
  } as unknown as DataSource;

  function setup(
    due: Notification[],
    strategy: Partial<NotificationChannelStrategy>,
  ) {
    const repo = {
      claimDue: jest.fn().mockResolvedValue(due),
      lease: jest.fn(),
      markSent: jest.fn(),
      markSkipped: jest.fn(),
      recordFailure: jest.fn(),
      defer: jest.fn(),
    };
    const telegram: NotificationChannelStrategy = {
      channel: NotificationChannel.TELEGRAM,
      send: jest.fn().mockResolvedValue(undefined),
      ...strategy,
    };
    const dispatcher = new NotificationDispatcher(
      [telegram],
      repo as unknown as NotificationsRepository,
      dataSource,
    );
    return { dispatcher, repo, telegram };
  }

  it('sends one message for a whole group and marks every row SENT', async () => {
    const rows = [
      row({ payload: payload(['A1']) }),
      row({ payload: payload(['A2']) }),
    ];
    const { dispatcher, repo, telegram } = setup(rows, {});
    const summary = await dispatcher.dispatchDue(new Date());
    expect(telegram.send).toHaveBeenCalledTimes(1);
    expect((telegram.send as jest.Mock).mock.calls[0][1].body).toContain(
      'seats A1, A2',
    );
    expect(repo.markSent).toHaveBeenCalledWith(
      manager,
      rows.map((r) => r.id),
      expect.any(Date),
      expect.any(Date),
    );
    expect(summary.sent).toBe(2);
  });

  it('skips users without a linked chat (send reports it; no separate lookup)', async () => {
    const { dispatcher, repo } = setup([row()], {
      send: jest
        .fn()
        .mockRejectedValue(new RecipientUnreachableError('No linked Telegram chat')),
    });
    const summary = await dispatcher.dispatchDue(new Date());
    expect(repo.markSkipped).toHaveBeenCalled();
    expect(summary.skipped).toBe(1);
  });

  it('skips when the recipient is unreachable (bot blocked)', async () => {
    const { dispatcher, repo } = setup([row()], {
      send: jest
        .fn()
        .mockRejectedValue(new RecipientUnreachableError('blocked')),
    });
    const summary = await dispatcher.dispatchDue(new Date());
    expect(repo.markSkipped).toHaveBeenCalled();
    expect(summary.skipped).toBe(1);
  });

  it('retries transient failures later, then gives up', async () => {
    const failing = { send: jest.fn().mockRejectedValue(new Error('timeout')) };
    const first = setup([row({ attempts: 0 })], failing);
    await first.dispatcher.dispatchDue(new Date());
    expect(first.repo.recordFailure).toHaveBeenCalledWith(
      manager,
      expect.any(Array),
      'timeout',
      expect.any(Date),
      expect.any(Date),
    );

    const last = setup([row({ attempts: MAX_ATTEMPTS - 1 })], failing);
    const summary = await last.dispatcher.dispatchDue(new Date());
    expect(last.repo.recordFailure).toHaveBeenCalledWith(
      manager,
      expect.any(Array),
      'timeout',
      null,
      expect.any(Date),
    );
    expect(summary.failed).toBe(1);
  });

  it('fails rows whose channel has no strategy', async () => {
    const { dispatcher, repo } = setup(
      [
        row({
          channel: NotificationChannel.EMAIL,
          type: NotificationType.EMAIL_VERIFY_OTP,
        }),
      ],
      {},
    );
    await dispatcher.dispatchDue(new Date());
    expect(repo.recordFailure).toHaveBeenCalledWith(
      manager,
      expect.any(Array),
      expect.stringContaining('No delivery strategy'),
      null,
      expect.any(Date),
    );
  });

  it('leases the claimed rows, and guards every result write with that lease', async () => {
    const now = new Date('2026-11-09T03:00:00.000Z');
    const leasedUntil = new Date(now.getTime() + LEASE_MS);
    const r = row();
    const { dispatcher, repo } = setup([r], {});
    await dispatcher.dispatchDue(now);
    expect(repo.lease).toHaveBeenCalledWith(manager, [r.id], leasedUntil);
    expect(repo.markSent).toHaveBeenCalledWith(manager, [r.id], now, leasedUntil);
  });

  it('sends with no transaction open: claim commits first, each result in its own', async () => {
    let open = 0;
    const transactions: string[] = [];
    const ds = {
      transaction: async (fn: (m: EntityManager) => Promise<unknown>) => {
        open++;
        try {
          return await fn(manager);
        } finally {
          open--;
          transactions.push('tx');
        }
      },
    } as unknown as DataSource;
    const send = jest.fn(async () => {
      expect(open).toBe(0);
    });
    const repo = {
      claimDue: jest.fn().mockResolvedValue([row({ payload: payload(['A1'], 'g1') }), row({ payload: payload(['B1'], 'g2') })]),
      lease: jest.fn(),
      markSent: jest.fn(),
    };
    const dispatcher = new NotificationDispatcher(
      [{ channel: NotificationChannel.TELEGRAM, send }],
      repo as unknown as NotificationsRepository,
      ds,
    );
    const summary = await dispatcher.dispatchDue(new Date());
    expect(send).toHaveBeenCalledTimes(2);
    expect(summary.sent).toBe(2);
    expect(transactions).toHaveLength(3); // claim + one per batch
  });

  it('sends nothing when the claim transaction fails (no message without a lease)', async () => {
    const send = jest.fn();
    const ds = {
      transaction: () => Promise.reject(new Error('commit failed')),
    } as unknown as DataSource;
    const dispatcher = new NotificationDispatcher(
      [{ channel: NotificationChannel.TELEGRAM, send }],
      { claimDue: jest.fn() } as unknown as NotificationsRepository,
      ds,
    );
    await expect(dispatcher.dispatchDue(new Date())).rejects.toThrow('commit failed');
    expect(send).not.toHaveBeenCalled();
  });

  it('honours retry_after on 429 and defers the rest of the run for that channel', async () => {
    const now = new Date('2026-11-09T03:00:00.000Z');
    const a = row({ payload: payload(['A1'], 'g1') });
    const b = row({ payload: payload(['B1'], 'g2') });
    const send = jest
      .fn()
      .mockRejectedValue(new RateLimitedError('Too Many Requests', 300_000));
    const { dispatcher, repo } = setup([a, b], { send });
    const summary = await dispatcher.dispatchDue(now);

    expect(send).toHaveBeenCalledTimes(1); // stopped after the 429
    const retryAt = new Date(now.getTime() + 300_000); // 5 min > 1 min backoff
    expect(repo.recordFailure).toHaveBeenCalledWith(
      manager,
      [a.id],
      'Too Many Requests',
      retryAt,
      expect.any(Date),
    );
    expect(repo.defer).toHaveBeenCalledWith(manager, [b.id], retryAt, expect.any(Date));
    expect(summary.retrying).toBe(2);
  });

  it('uses the backoff when it is longer than retry_after', async () => {
    const now = new Date('2026-11-09T03:00:00.000Z');
    const { dispatcher, repo } = setup([row({ attempts: 3 })], {
      send: jest.fn().mockRejectedValue(new RateLimitedError('429', 1_000)),
    });
    await dispatcher.dispatchDue(now);
    expect(repo.recordFailure).toHaveBeenCalledWith(
      manager,
      expect.any(Array),
      '429',
      nextAttemptAt(now, 4),
      expect.any(Date),
    );
  });
});

describe('NotificationDispatcher: failure isolation and logging', () => {
  const manager = {} as EntityManager;
  const dataSource = {
    transaction: (fn: (m: EntityManager) => Promise<unknown>) => fn(manager),
  } as unknown as DataSource;
  let log: jest.SpyInstance;
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  function setup(
    due: Notification[],
    send = jest.fn().mockResolvedValue(undefined),
  ) {
    const repo = {
      claimDue: jest.fn().mockResolvedValue(due),
      lease: jest.fn(),
      markSent: jest.fn(),
      markSkipped: jest.fn(),
      recordFailure: jest.fn(),
      defer: jest.fn(),
    };
    const telegram: NotificationChannelStrategy = {
      channel: NotificationChannel.TELEGRAM,
      send,
    };
    const dispatcher = new NotificationDispatcher(
      [telegram],
      repo as unknown as NotificationsRepository,
      dataSource,
    );
    return { dispatcher, repo, send };
  }

  it('a payload that fails to render fails only its batch; the rest is still sent', async () => {
    const good = row({ payload: payload(['A1'], 'g-good') });
    const bad = row({
      payload: { ...payload(['B1'], 'g-bad'), startAt: 'not-a-date' },
    });
    const { dispatcher, repo, send } = setup([bad, good]);

    // Before the fix this threw RangeError and rolled back the whole batch.
    const summary = await dispatcher.dispatchDue(new Date());

    expect(summary).toMatchObject({ sent: 1, failed: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(repo.markSent).toHaveBeenCalledWith(
      manager,
      [good.id],
      expect.any(Date),
      expect.any(Date),
    );
    expect(repo.recordFailure).toHaveBeenCalledWith(
      manager,
      [bad.id],
      expect.stringContaining('Template failed'),
      null,
      expect.any(Date),
    );
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('failed permanently'),
    );
  });

  it('warns on a retryable failure and errors when giving up', async () => {
    const failing = jest.fn().mockRejectedValue(new Error('timeout'));
    await setup([row({ attempts: 0 })], failing).dispatcher.dispatchDue(
      new Date(),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('will retry: timeout'),
    );
    expect(error).not.toHaveBeenCalled();

    await setup(
      [row({ attempts: MAX_ATTEMPTS - 1 })],
      failing,
    ).dispatcher.dispatchDue(new Date());
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining(
        `failed permanently after ${MAX_ATTEMPTS} attempts`,
      ),
    );
  });

  it('logs a skip for an unreachable recipient, and never the message text', async () => {
    const { dispatcher } = setup(
      [row()],
      jest.fn().mockRejectedValue(new RecipientUnreachableError('blocked')),
    );
    await dispatcher.dispatchDue(new Date());
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('skipped: blocked'),
    );
    const lines = [...log.mock.calls, ...warn.mock.calls, ...error.mock.calls]
      .map(([m]) => String(m))
      .join('\n');
    expect(lines).not.toContain('Demo Library'); // payload content stays out of logs
  });
});

describe('TelegramApiError.isRecipientGone', () => {
  it.each([
    [403, 'Forbidden: bot was blocked by the user', true],
    [400, 'Bad Request: chat not found', true],
    [400, 'Forbidden: user is deactivated', true],
    [400, 'Bad Request: message text is empty', false],
    [429, 'Too Many Requests: retry after 5', false],
    [502, 'non-JSON response to sendMessage', false],
  ])('%i %s -> %s', (code, description, gone) => {
    expect(new TelegramApiError(code, description).isRecipientGone).toBe(gone);
  });

  it('keeps retry_after on a 429', () => {
    const err = new TelegramApiError(429, 'Too Many Requests: retry after 7', 7);
    expect(err.isRateLimited).toBe(true);
    expect(err.retryAfterSeconds).toBe(7);
  });
});

describe('Telegram rate limiting (429)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('TelegramBotClient keeps parameters.retry_after on the error', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      status: 429,
      json: async () => ({
        ok: false,
        error_code: 429,
        description: 'Too Many Requests: retry after 12',
        parameters: { retry_after: 12 },
      }),
    } as unknown as Response);
    const client = new TelegramBotClient({
      botToken: 'test-token',
      apiBaseUrl: 'https://telegram.invalid',
    } as unknown as ConstructorParameters<typeof TelegramBotClient>[0]);
    const err = await client.sendMessage('1', 'hi').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TelegramApiError);
    expect((err as TelegramApiError).retryAfterSeconds).toBe(12);
  });

  it('TelegramChannel turns a 429 into RateLimitedError with the wait in ms', async () => {
    const channel = new TelegramChannel(
      { findLiveChatId: async () => '42' } as unknown as TelegramAccountsService,
      {
        sendMessage: () =>
          Promise.reject(new TelegramApiError(429, 'Too Many Requests', 12)),
      } as unknown as TelegramBotClient,
    );
    const err = await channel
      .send('u1', { title: 't', body: 'b' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitedError);
    expect((err as RateLimitedError).retryAfterMs).toBe(12_000);
  });

  it('TelegramChannel reports a user without a linked chat as unreachable', async () => {
    const channel = new TelegramChannel(
      { findLiveChatId: async () => null } as unknown as TelegramAccountsService,
      {} as TelegramBotClient,
    );
    await expect(
      channel.send('u1', { title: 't', body: 'b' }),
    ).rejects.toBeInstanceOf(RecipientUnreachableError);
  });
});
