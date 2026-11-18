import { registerAs } from '@nestjs/config';

// Telegram Bot API. The bot token and webhook secret are secrets: never log them.
export const telegramConfig = registerAs('telegram', () => ({
  botToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
  // Without the leading @, used to build https://t.me/<username>?start=<code>.
  botUsername: process.env.TELEGRAM_BOT_USERNAME ?? '',
  // Telegram echoes it in X-Telegram-Bot-Api-Secret-Token on every webhook call.
  webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET ?? '',
  // Public URL of POST /api/v1/webhooks/telegram. Empty = don't register the webhook.
  webhookUrl: process.env.TELEGRAM_WEBHOOK_URL ?? '',
  linkTtlMinutes: Number(process.env.TELEGRAM_LINK_TTL_MINUTES ?? 10),
  apiBaseUrl: 'https://api.telegram.org',
}));
