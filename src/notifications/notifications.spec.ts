import { DataSource, EntityManager } from 'typeorm';
import {
  NotificationChannel,
  NotificationStatus,
  NotificationType,
} from '../common/enums';
import {
  NotificationChannelStrategy,
  RecipientUnreachableError,
} from './channels/notification-channel.strategy';
import { escapeTelegramHtml, formatForTelegram } from './channels/telegram.channel';
import { Notification } from './entities/notification.entity';
import { NotificationsRepository } from './repositories/notifications.repository';
import {
  groupForDelivery,
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
    const msg = renderNotification(NotificationType.LATE_CHECKIN, payload(['A1']));
    expect(msg?.body).toContain('started at 10:00');
    expect(msg?.body).toContain('before 10:15');
  });

  it('lists every seat of a multi-seat booking', () => {
    const msg = renderNotification(NotificationType.BOOKING_CONFIRMED, payload(['A1', 'A2']));
    expect(msg?.body).toContain('seats A1, A2');
  });

  it.each([
    NotificationType.BOOKING_CONFIRMED,
    NotificationType.BOOKING_CANCELLED,
    NotificationType.LATE_CHECKIN,
    NotificationType.CHECKOUT_REMINDER,
    NotificationType.BOOKING_EXPIRED,
    NotificationType.FORGOTTEN_CHECKOUT,
  ])('has a template for %s', (type) => {
    expect(renderNotification(type, payload(['A1']))).not.toBeNull();
  });

  it('has no template for auth emails (owned by auth)', () => {
    expect(renderNotification(NotificationType.EMAIL_VERIFY_OTP, payload(['A1']))).toBeNull();
  });

  it('escapes HTML for Telegram', () => {
    expect(escapeTelegramHtml('<b>&')).toBe('&lt;b&gt;&amp;');
    expect(formatForTelegram({ title: 'T<', body: 'B>' })).toBe('<b>T&lt;</b>\nB&gt;');
  });
});

describe('NotificationsService.channelFor', () => {
  const service = new NotificationsService({} as NotificationsRepository);

  it('sends auth OTPs by email and booking alerts by Telegram', () => {
    expect(service.channelFor(NotificationType.PASSWORD_RESET_OTP)).toBe(NotificationChannel.EMAIL);
    expect(service.channelFor(NotificationType.LATE_CHECKIN)).toBe(NotificationChannel.TELEGRAM);
  });
});

describe('dispatcher helpers', () => {
  it('groups the rows of one multi-seat booking into one delivery', () => {
    const batches = groupForDelivery([
      row({ payload: payload(['A1'], 'g1') }),
      row({ payload: payload(['A2'], 'g1') }),
      row({ payload: payload(['B1'], 'g2') }),
      row({ type: NotificationType.BOOKING_CONFIRMED, payload: payload(['A1'], 'g1') }),
    ]);
    expect(batches.map((b) => b.length).sort()).toEqual([1, 1, 2]);
  });

  it('merges and sorts seat labels', () => {
    expect(
      mergePayloads([row({ payload: payload(['A2']) }), row({ payload: payload(['A1']) })]).seatLabels,
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

  function setup(due: Notification[], strategy: Partial<NotificationChannelStrategy>) {
    const repo = {
      claimDue: jest.fn().mockResolvedValue(due),
      markSent: jest.fn(),
      markSkipped: jest.fn(),
      recordFailure: jest.fn(),
    };
    const telegram: NotificationChannelStrategy = {
      channel: NotificationChannel.TELEGRAM,
      isAvailableFor: jest.fn().mockResolvedValue(true),
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
    const rows = [row({ payload: payload(['A1']) }), row({ payload: payload(['A2']) })];
    const { dispatcher, repo, telegram } = setup(rows, {});
    const summary = await dispatcher.dispatchDue(new Date());
    expect(telegram.send).toHaveBeenCalledTimes(1);
    expect((telegram.send as jest.Mock).mock.calls[0][1].body).toContain('seats A1, A2');
    expect(repo.markSent).toHaveBeenCalledWith(manager, rows.map((r) => r.id), expect.any(Date));
    expect(summary.sent).toBe(2);
  });

  it('skips users without a linked chat', async () => {
    const { dispatcher, repo, telegram } = setup([row()], {
      isAvailableFor: jest.fn().mockResolvedValue(false),
    });
    await dispatcher.dispatchDue(new Date());
    expect(telegram.send).not.toHaveBeenCalled();
    expect(repo.markSkipped).toHaveBeenCalled();
  });

  it('skips when the recipient is unreachable (bot blocked)', async () => {
    const { dispatcher, repo } = setup([row()], {
      send: jest.fn().mockRejectedValue(new RecipientUnreachableError('blocked')),
    });
    const summary = await dispatcher.dispatchDue(new Date());
    expect(repo.markSkipped).toHaveBeenCalled();
    expect(summary.skipped).toBe(1);
  });

  it('retries transient failures later, then gives up', async () => {
    const failing = { send: jest.fn().mockRejectedValue(new Error('timeout')) };
    const first = setup([row({ attempts: 0 })], failing);
    await first.dispatcher.dispatchDue(new Date());
    expect(first.repo.recordFailure).toHaveBeenCalledWith(manager, expect.any(Array), 'timeout', expect.any(Date));

    const last = setup([row({ attempts: MAX_ATTEMPTS - 1 })], failing);
    const summary = await last.dispatcher.dispatchDue(new Date());
    expect(last.repo.recordFailure).toHaveBeenCalledWith(manager, expect.any(Array), 'timeout', null);
    expect(summary.failed).toBe(1);
  });

  it('fails rows whose channel has no strategy', async () => {
    const { dispatcher, repo } = setup(
      [row({ channel: NotificationChannel.EMAIL, type: NotificationType.EMAIL_VERIFY_OTP })],
      {},
    );
    await dispatcher.dispatchDue(new Date());
    expect(repo.recordFailure).toHaveBeenCalledWith(
      manager,
      expect.any(Array),
      expect.stringContaining('No delivery strategy'),
      null,
    );
  });
});
