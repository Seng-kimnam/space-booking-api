import { INestApplication } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { randomInt, randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import {
  MAX_ATTEMPTS,
  NotificationDispatcher,
} from '../../../src/notifications/services/notification-dispatcher.service';
import { createTestApp } from '../../utils/create-test-app';

// The bot must look configured; fetch is stubbed below, nothing reaches Telegram.
Object.assign(process.env, {
  TELEGRAM_BOT_TOKEN: 'e2e-bot-token',
  TELEGRAM_BOT_USERNAME: 'sb_e2e_bot',
  TELEGRAM_WEBHOOK_URL: '',
});

/**
 * Drives NotificationDispatcher.dispatchDue against real rows. Each run uses a
 * clock in the year 2000 and rows scheduled before it, so a run only claims
 * this suite's rows, never pending alerts other suites left in the test DB.
 * BOOKING_CONFIRMED rows without a booking keep booking.alert_due out of it.
 */
describe('notification dispatcher (real Postgres, stubbed Bot API)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let dispatcher: NotificationDispatcher;
  let fetchSpy: jest.SpyInstance;
  /** Bot API answers for the next calls, in order; then { ok: true }. */
  let replies: object[] = [];
  const userIds: string[] = [];

  const NOW = new Date('2000-01-01T00:00:00Z');
  const DUE = '1999-12-31T23:59:00Z';

  const payload = (overrides: object = {}) => ({
    groupId: randomUUID(),
    placeName: 'E2E Library',
    timezone: 'Asia/Phnom_Penh',
    seatLabels: ['A1'],
    startAt: '2000-01-01T03:00:00Z',
    endAt: '2000-01-01T04:00:00Z',
    ...overrides,
  });

  const newUser = async (opts: { telegram?: boolean } = {}) => {
    const [{ id: roleId }] = await ds.query(`SELECT id FROM roles WHERE name = 'USER'`);
    const [row] = await ds.query(
      `INSERT INTO users (role_id, name, email, password_hash, email_verified_at)
       VALUES ($1, 'E2E', $2, 'x', now()) RETURNING id`,
      [roleId, `e2e-notif-${randomUUID()}@example.test`],
    );
    userIds.push(row.id);
    const chatId = randomInt(100_000_000, 999_999_999);
    if (opts.telegram !== false)
      await ds.query(
        'INSERT INTO telegram_accounts (user_id, chat_id) VALUES ($1, $2)',
        [row.id, chatId],
      );
    return { id: row.id as string, chatId };
  };

  const insertAlert = async (
    userId: string,
    data: object,
    attempts = 0,
  ): Promise<string> => {
    const [row] = await ds.query(
      `INSERT INTO notifications (user_id, channel, type, scheduled_at, attempts, payload)
       VALUES ($1, 'TELEGRAM', 'BOOKING_CONFIRMED', $2, $3, $4) RETURNING id`,
      [userId, DUE, attempts, JSON.stringify(data)],
    );
    return row.id;
  };

  const row = async (id: string) =>
    (
      await ds.query(
        `SELECT status, attempts, last_error AS "lastError", sent_at AS "sentAt",
                scheduled_at AS "scheduledAt"
           FROM notifications WHERE id = $1`,
        [id],
      )
    )[0] as {
      status: string;
      attempts: number;
      lastError: string | null;
      sentAt: Date | null;
      scheduledAt: Date;
    };

  const sentTexts = (chatId: number): string[] =>
    fetchSpy.mock.calls
      .filter(([url]) => String(url).endsWith('/sendMessage'))
      .map(([, init]) => JSON.parse((init as RequestInit).body as string))
      .filter((b) => b.chat_id === String(chatId))
      .map((b) => b.text as string);

  beforeAll(async () => {
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      const body = replies.shift() ?? { ok: true, result: {} };
      return new Response(JSON.stringify(body));
    });
    app = await createTestApp();
    ds = app.get(DataSource);
    dispatcher = app.get(NotificationDispatcher);
    // The real dispatch job would race this test for the same rows.
    for (const job of app.get(SchedulerRegistry).getCronJobs().values()) job.stop();
  });

  afterAll(async () => {
    // notifications and telegram_accounts cascade with the user.
    await ds.query('DELETE FROM users WHERE id = ANY($1)', [userIds]);
    await app.close();
    fetchSpy.mockRestore();
  });

  beforeEach(() => {
    replies = [];
    fetchSpy.mockClear();
  });

  it('sends a due alert to the linked chat and marks it SENT', async () => {
    const u = await newUser();
    const id = await insertAlert(u.id, payload({ seatLabels: ['B7'] }));

    await dispatcher.dispatchDue(NOW);

    expect(await row(id)).toMatchObject({ status: 'SENT', attempts: 0, lastError: null });
    expect((await row(id)).sentAt).not.toBeNull();
    const [text] = sentTexts(u.chatId);
    expect(text).toContain('<b>Booking confirmed</b>');
    expect(text).toContain('seat B7 at E2E Library');
  });

  it('sends rows of one multi-seat booking as a single message', async () => {
    const u = await newUser();
    const groupId = randomUUID();
    const ids = [
      await insertAlert(u.id, payload({ groupId, seatLabels: ['A2'] })),
      await insertAlert(u.id, payload({ groupId, seatLabels: ['A1'] })),
    ];

    await dispatcher.dispatchDue(NOW);

    for (const id of ids) expect((await row(id)).status).toBe('SENT');
    const texts = sentTexts(u.chatId);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain('seats A1, A2');
  });

  it('a claimed row is not sent twice by the next run', async () => {
    const u = await newUser();
    await insertAlert(u.id, payload());
    await dispatcher.dispatchDue(NOW);
    await dispatcher.dispatchDue(NOW);
    expect(sentTexts(u.chatId)).toHaveLength(1);
  });

  it('SKIPPED, without calling Telegram, when the user has no linked chat', async () => {
    const u = await newUser({ telegram: false });
    const id = await insertAlert(u.id, payload());

    await dispatcher.dispatchDue(NOW);

    expect(await row(id)).toMatchObject({
      status: 'SKIPPED',
      lastError: 'No linked Telegram chat',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a temporary Telegram error is retried later with backoff', async () => {
    const u = await newUser();
    const id = await insertAlert(u.id, payload());
    replies = [{ ok: false, error_code: 502, description: 'Bad Gateway' }];

    await dispatcher.dispatchDue(NOW);

    const r = await row(id);
    expect(r).toMatchObject({ status: 'PENDING', attempts: 1 });
    expect(r.lastError).toContain('502');
    // First retry after 1 minute (nextAttemptAt).
    expect(r.scheduledAt.toISOString()).toBe('2000-01-01T00:01:00.000Z');
  });

  it(`FAILED after the ${MAX_ATTEMPTS}th failed attempt`, async () => {
    const u = await newUser();
    const id = await insertAlert(u.id, payload(), MAX_ATTEMPTS - 1);
    replies = [{ ok: false, error_code: 500, description: 'Internal Server Error' }];

    await dispatcher.dispatchDue(NOW);

    expect(await row(id)).toMatchObject({ status: 'FAILED', attempts: MAX_ATTEMPTS });
  });

  it('the user blocked the bot (403): unlinks the chat and SKIPS', async () => {
    const u = await newUser();
    const id = await insertAlert(u.id, payload());
    replies = [{ ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }];

    await dispatcher.dispatchDue(NOW);

    expect(await row(id)).toMatchObject({ status: 'SKIPPED' });
    const [{ live }] = await ds.query(
      'SELECT count(*)::int AS live FROM telegram_accounts WHERE user_id = $1 AND unlinked_at IS NULL',
      [u.id],
    );
    expect(live).toBe(0);
  });

  it('a 429 honours retry_after and holds the rest of the run', async () => {
    const a = await newUser();
    const b = await newUser();
    const first = await insertAlert(a.id, payload());
    const second = await insertAlert(b.id, payload());
    replies = [{ ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 300 } }];

    const summary = await dispatcher.dispatchDue(NOW);

    expect(summary.retrying).toBeGreaterThanOrEqual(2);
    // Only one sendMessage: the channel is throttled after the 429.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const retryAt = NOW.getTime() + 300_000;
    for (const id of [first, second]) {
      const r = await row(id);
      expect(r.status).toBe('PENDING');
      expect(r.scheduledAt.getTime()).toBeGreaterThanOrEqual(retryAt);
    }
  });

  it('a payload the template cannot render FAILS that row only', async () => {
    const bad = await newUser();
    const good = await newUser();
    const badId = await insertAlert(bad.id, payload({ timezone: 'Not/AZone' }));
    const goodId = await insertAlert(good.id, payload());

    await dispatcher.dispatchDue(NOW);

    const r = await row(badId);
    expect(r.status).toBe('FAILED');
    expect(r.lastError).toContain('Template failed');
    expect(sentTexts(bad.chatId)).toHaveLength(0);
    expect((await row(goodId)).status).toBe('SENT');
  });
});
