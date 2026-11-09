/**
 * LOCAL DEV ONLY: lets the Telegram bot work against a localhost API without a
 * public tunnel. Telegram can't call http://localhost, so this script pulls the
 * bot's pending updates (getUpdates) and forwards each one to our own webhook
 * endpoint with the secret header, exactly as Telegram would. The API then
 * handles /start <code>, /stop, /status and "user blocked the bot" as usual,
 * so the same code path is exercised as in production.
 *
 *   npm run telegram:poll            # keep forwarding until Ctrl+C
 *   npm run telegram:poll -- --once  # forward what is pending, then exit
 *
 * Needs TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET in .env, and the API
 * running (npm run start:dev). Telegram allows either a webhook or getUpdates,
 * not both: leave TELEGRAM_WEBHOOK_URL empty while using this.
 */
import 'dotenv/config';

const token = process.env.TELEGRAM_BOT_TOKEN ?? '';
const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? '';
const target =
  process.env.TELEGRAM_POLL_TARGET ??
  `http://localhost:${process.env.PORT ?? 3000}/api/v1/webhooks/telegram`;
const once = process.argv.includes('--once');

// Never print the token: it is part of every Bot API URL.
const api = (method: string) => `https://api.telegram.org/bot${token}/${method}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface BotResponse<T> {
  ok: boolean;
  result: T;
  description?: string;
}
interface Update {
  update_id: number;
  message?: { text?: string };
  my_chat_member?: unknown;
}

async function call<T>(method: string, body: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(api(method), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(40_000),
  });
  const data = (await res.json()) as BotResponse<T>;
  if (!data.ok) throw new Error(`${method} failed: ${data.description ?? res.status}`);
  return data.result;
}

/** What kind of update it is, without logging message text or link codes. */
function describe(u: Update): string {
  const text = u.message?.text?.trim() ?? '';
  if (text.startsWith('/')) return `command ${text.split(/\s+/)[0]}`;
  if (u.message) return 'message';
  if (u.my_chat_member) return 'chat member change';
  return 'other update';
}

async function forward(update: Update): Promise<boolean> {
  try {
    const res = await fetch(target, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': secret,
      },
      body: JSON.stringify(update),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 401) {
      console.error('API rejected the secret: TELEGRAM_WEBHOOK_SECRET must match the running API.');
      process.exit(1);
    }
    return res.ok;
  } catch {
    return false; // API not running yet
  }
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Dev-only script; production uses the real webhook');
  }
  if (!token || !secret) {
    throw new Error('Set TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET in .env');
  }

  const info = await call<{ url: string }>('getWebhookInfo');
  if (info.url) {
    throw new Error(
      'This bot has a webhook set, so getUpdates is disabled. Empty TELEGRAM_WEBHOOK_URL, ' +
        'restart the API, then call deleteWebhook (or just keep using the webhook).',
    );
  }

  const me = await call<{ username: string }>('getMe');
  console.log(`Polling @${me.username} -> ${target}${once ? ' (once)' : ''}`);

  let offset = 0;
  for (;;) {
    const updates = await call<Update[]>('getUpdates', {
      offset,
      timeout: once ? 0 : 30,
      allowed_updates: ['message', 'my_chat_member'],
    });

    for (const update of updates) {
      // Only move past an update once the API accepted it, so nothing is lost
      // while the API is down; the webhook dedupes redeliveries via inbox_events.
      while (!(await forward(update))) {
        console.warn(`API not reachable at ${target}, retrying in 3s...`);
        await sleep(3_000);
      }
      offset = update.update_id + 1;
      console.log(`forwarded update ${update.update_id} (${describe(update)})`);
    }

    if (once) {
      // Confirm the processed updates to Telegram so they aren't delivered again.
      if (offset) await call('getUpdates', { offset, timeout: 0 });
      console.log(updates.length ? 'Done.' : 'No pending updates.');
      return;
    }
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
