import { INestApplication } from '@nestjs/common';
import { randomInt, randomUUID } from 'crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from '../../utils/create-test-app';
import { signToken } from '../../utils/auth-tokens';

// Telegram config is read when the app boots, so set it before createTestApp.
// Fixed values (not ??=) so a local .env can't point the test at a real bot.
const SECRET = 'e2e-telegram-webhook-secret';
const BOT = 'sb_e2e_bot';
Object.assign(process.env, {
  TELEGRAM_BOT_TOKEN: 'e2e-bot-token',
  TELEGRAM_BOT_USERNAME: BOT,
  TELEGRAM_WEBHOOK_SECRET: SECRET,
  TELEGRAM_WEBHOOK_URL: '', // don't call setWebhook on boot
});

describe('telegram linking and webhook (real Postgres, stubbed Bot API)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let fetchSpy: jest.SpyInstance;
  const userIds: string[] = [];
  const updateIds: string[] = [];

  // update_id is unique per source in inbox_events: random base per run.
  let nextUpdateId = randomInt(1_000_000, 1_000_000_000);
  const newChatId = () => randomInt(100_000_000, 999_999_999);

  const api = (m: 'post' | 'get' | 'delete', url: string, token?: string) => {
    const r = request(app.getHttpServer())[m](`/api/v1${url}`);
    return token ? r.set('Authorization', `Bearer ${token}`) : r;
  };
  const webhook = (update: object, secret: string | null = SECRET) => {
    const r = request(app.getHttpServer()).post('/api/v1/webhooks/telegram');
    return (secret ? r.set('X-Telegram-Bot-Api-Secret-Token', secret) : r).send(update);
  };
  const message = (chatId: number, text: string, updateId = nextUpdateId++) => {
    updateIds.push(String(updateId));
    return {
      update_id: updateId,
      message: {
        message_id: 1,
        date: 0,
        text,
        chat: { id: chatId, type: 'private' },
        from: { id: chatId, is_bot: false, first_name: 'E2E', username: 'e2e_user' },
      },
    };
  };
  /** Bot API messages sent to `chatId` (sendMessage bodies). */
  const sentTo = (chatId: number): string[] =>
    fetchSpy.mock.calls
      .filter(([url]) => String(url).endsWith('/sendMessage'))
      .map(([, init]) => JSON.parse((init as RequestInit).body as string))
      .filter((b) => b.chat_id === String(chatId))
      .map((b) => b.text as string);

  const newUser = async () => {
    const [{ id: roleId }] = await ds.query(`SELECT id FROM roles WHERE name = 'USER'`);
    const [row] = await ds.query(
      `INSERT INTO users (role_id, name, email, password_hash, email_verified_at)
       VALUES ($1, 'E2E', $2, 'x', now()) RETURNING id`,
      [roleId, `e2e-tg-${randomUUID()}@example.test`],
    );
    userIds.push(row.id);
    return { id: row.id as string, token: await signToken(app, 'USER', row.id) };
  };
  /** Issues a deep link and returns its one-time code. */
  const linkCode = async (token: string): Promise<string> => {
    const res = await api('post', '/telegram/link', token);
    expect(res.status).toBe(201);
    const url = new URL(res.body.url);
    expect(`${url.origin}${url.pathname}`).toBe(`https://t.me/${BOT}`);
    return url.searchParams.get('start')!;
  };
  const status = async (token: string) =>
    (await api('get', '/telegram/status', token)).body as {
      linked: boolean;
      username: string | null;
    };

  beforeAll(async () => {
    fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(
        async () => new Response(JSON.stringify({ ok: true, result: {} })),
      );
    app = await createTestApp();
    ds = app.get(DataSource);
  });

  afterAll(async () => {
    await ds.query('DELETE FROM telegram_accounts WHERE user_id = ANY($1)', [userIds]);
    await ds.query('DELETE FROM user_otps WHERE user_id = ANY($1)', [userIds]);
    await ds.query(
      `DELETE FROM inbox_events WHERE source = 'telegram' AND message_id = ANY($1)`,
      [updateIds],
    );
    await ds.query('DELETE FROM users WHERE id = ANY($1)', [userIds]);
    await app.close();
    fetchSpy.mockRestore();
  });

  beforeEach(() => fetchSpy.mockClear());

  describe('user routes: authentication and authorization', () => {
    it.each([
      ['post', '/telegram/link'],
      ['get', '/telegram/status'],
      ['delete', '/telegram/unlink'],
    ] as const)('%s %s: 401 without token, 403 for ADMIN', async (m, url) => {
      expect((await api(m, url)).status).toBe(401);
      expect((await api(m, url, await signToken(app, 'ADMIN'))).status).toBe(403);
    });
  });

  describe('webhook secret', () => {
    it('401 without or with a wrong secret header, 200 with the right one', async () => {
      const update = message(newChatId(), '/status');
      expect((await webhook(update, null)).status).toBe(401);
      expect((await webhook(update, 'wrong-secret')).status).toBe(401);
      const ok = await webhook(update);
      expect(ok.status).toBe(200);
      expect(ok.body).toEqual({ ok: true });
    });

    it('answers 200 even for an update it cannot use', async () => {
      expect((await webhook({ foo: 'bar' })).status).toBe(200);
      expect((await webhook({ update_id: nextUpdateId++, message: null })).status).toBe(200);
    });
  });

  describe('link via /start <code>', () => {
    it('links the chat, replies, and records the update once', async () => {
      const { id: userId, token } = await newUser();
      expect(await status(token)).toMatchObject({ linked: false });

      const code = await linkCode(token);
      const chatId = newChatId();
      const start = message(chatId, `/start ${code}`);
      expect((await webhook(start)).status).toBe(200);

      expect(await status(token)).toMatchObject({ linked: true, username: 'e2e_user' });
      expect(sentTo(chatId)).toHaveLength(1);

      // The inbox row has the command, never the text with the code.
      const [inbox] = await ds.query(
        `SELECT payload FROM inbox_events WHERE source = 'telegram' AND message_id = $1`,
        [String(start.update_id)],
      );
      expect(inbox.payload).toEqual({ chatId, command: '/start' });
      expect(JSON.stringify(inbox.payload)).not.toContain(code);

      // Telegram redelivers the same update: processed once, no second reply.
      fetchSpy.mockClear();
      expect((await webhook(start)).status).toBe(200);
      expect(sentTo(chatId)).toHaveLength(0);

      // Already linked: a new link is refused.
      expect((await api('post', '/telegram/link', token)).status).toBe(409);

      const [{ count }] = await ds.query(
        'SELECT count(*)::int FROM telegram_accounts WHERE user_id = $1 AND unlinked_at IS NULL',
        [userId],
      );
      expect(count).toBe(1);
    });

    it('a code works once; a used or unknown code links nothing', async () => {
      const first = await newUser();
      const code = await linkCode(first.token);
      await webhook(message(newChatId(), `/start ${code}`));
      expect((await status(first.token)).linked).toBe(true);

      const otherChat = newChatId();
      await webhook(message(otherChat, `/start ${code}`));
      await webhook(message(otherChat, '/start not-a-real-code'));
      await webhook(message(otherChat, '/status'));
      expect(sentTo(otherChat).at(-1)).toContain('not subscribed');
    });

    it('a chat already linked to another account is not taken over', async () => {
      const a = await newUser();
      const b = await newUser();
      const chatId = newChatId();
      await webhook(message(chatId, `/start ${await linkCode(a.token)}`));
      await webhook(message(chatId, `/start ${await linkCode(b.token)}`));

      expect((await status(a.token)).linked).toBe(true);
      expect((await status(b.token)).linked).toBe(false);
    });
  });

  describe('unlink', () => {
    const linked = async () => {
      const u = await newUser();
      const chatId = newChatId();
      await webhook(message(chatId, `/start ${await linkCode(u.token)}`));
      expect((await status(u.token)).linked).toBe(true);
      return { ...u, chatId };
    };

    it('DELETE /telegram/unlink: 204, idempotent, and tells the chat', async () => {
      const u = await linked();
      fetchSpy.mockClear();
      expect((await api('delete', '/telegram/unlink', u.token)).status).toBe(204);
      expect((await status(u.token)).linked).toBe(false);
      expect(sentTo(u.chatId)).toHaveLength(1);
      expect((await api('delete', '/telegram/unlink', u.token)).status).toBe(204);
    });

    it('/stop from Telegram unlinks', async () => {
      const u = await linked();
      await webhook(message(u.chatId, '/stop'));
      expect((await status(u.token)).linked).toBe(false);
    });

    it('blocking the bot (my_chat_member kicked) unlinks silently', async () => {
      const u = await linked();
      fetchSpy.mockClear();
      const updateId = nextUpdateId++;
      updateIds.push(String(updateId));
      await webhook({
        update_id: updateId,
        my_chat_member: {
          chat: { id: u.chatId, type: 'private' },
          from: { id: u.chatId, is_bot: false, first_name: 'E2E' },
          date: 0,
          old_chat_member: { status: 'member', user: { id: 1, is_bot: true, first_name: 'bot' } },
          new_chat_member: { status: 'kicked', user: { id: 1, is_bot: true, first_name: 'bot' } },
        },
      });
      expect((await status(u.token)).linked).toBe(false);
      expect(sentTo(u.chatId)).toHaveLength(0);
    });
  });
});
