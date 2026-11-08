import { Inject, Injectable, Logger } from '@nestjs/common';
import { TelegramBotClient } from '../telegram-bot.client';
import { INBOX } from '../telegram.ports';
import type { InboxPort } from '../telegram.ports';
import type { TelegramUpdate } from '../telegram.types';
import { TelegramAccountsService } from './telegram-accounts.service';
import type { LinkChatResult } from './telegram-accounts.service';

export const TELEGRAM_INBOX_SOURCE = 'telegram';

const HELP_TEXT = [
  '<b>Space Booking bot</b>',
  'I send alerts about your seat bookings.',
  '',
  'To subscribe, open the Telegram link from the app.',
  '/status - check whether this chat is linked',
  '/stop - unsubscribe from alerts',
].join('\n');

/** Splits "/start@MyBot abc" into { command: '/start', arg: 'abc' }. */
export function parseCommand(
  text: string,
): { command: string; arg: string } | null {
  const match = /^(\/[a-zA-Z_]+)(?:@\w+)?(?:\s+(.*))?$/.exec(text.trim());
  if (!match) return null;
  return { command: match[1].toLowerCase(), arg: (match[2] ?? '').trim() };
}

/**
 * Handles webhook updates. Every update is recorded in inbox_events first
 * (AGENTS.md section 6.12), so a Telegram redelivery is processed once.
 */
@Injectable()
export class TelegramUpdatesService {
  private readonly logger = new Logger(TelegramUpdatesService.name);

  constructor(
    private readonly accounts: TelegramAccountsService,
    private readonly bot: TelegramBotClient,
    @Inject(INBOX) private readonly inbox: InboxPort,
  ) {}

  async handle(update: TelegramUpdate): Promise<void> {
    if (typeof update?.update_id !== 'number') return;

    await this.inbox.handleOnce(
      {
        source: TELEGRAM_INBOX_SOURCE,
        messageId: String(update.update_id),
        eventType: update.my_chat_member
          ? 'my_chat_member'
          : update.message
            ? 'message'
            : 'other',
        // Only what's needed for auditing. Never the message text: /start
        // carries the link code.
        payload: {
          chatId: update.message?.chat.id ?? update.my_chat_member?.chat.id ?? null,
          command: update.message?.text
            ? (parseCommand(update.message.text)?.command ?? null)
            : null,
        },
      },
      () => this.process(update),
    );
  }

  private async process(update: TelegramUpdate): Promise<void> {
    // The user blocked the bot or deleted the chat: unsubscribe them silently.
    if (update.my_chat_member) {
      const { chat, new_chat_member } = update.my_chat_member;
      if (
        chat.type === 'private' &&
        (new_chat_member.status === 'kicked' || new_chat_member.status === 'left')
      ) {
        await this.accounts.unlinkChat(String(chat.id));
      }
      return;
    }

    const message = update.message;
    if (!message?.text || message.chat.type !== 'private') return;

    const chatId = String(message.chat.id);
    const parsed = parseCommand(message.text);

    switch (parsed?.command) {
      case '/start': {
        if (!parsed.arg) {
          await this.reply(chatId, HELP_TEXT);
          return;
        }
        const result = await this.accounts.linkChat(
          parsed.arg,
          chatId,
          message.from?.username ?? null,
        );
        await this.reply(chatId, this.linkReply(result));
        return;
      }
      case '/stop':
      case '/unsubscribe': {
        const removed = await this.accounts.unlinkChat(chatId);
        await this.reply(
          chatId,
          removed
            ? 'You have unsubscribed. You will no longer get booking alerts here.'
            : 'This chat is not subscribed.',
        );
        return;
      }
      case '/status': {
        // Linked iff some live account points at this chat; we don't reveal whose.
        const linked = await this.accounts.isChatLinked(chatId);
        await this.reply(
          chatId,
          linked
            ? 'This chat is subscribed to booking alerts.'
            : 'This chat is not subscribed. Open the Telegram link from the app to subscribe.',
        );
        return;
      }
      default:
        await this.reply(chatId, HELP_TEXT);
    }
  }

  private linkReply(result: LinkChatResult): string {
    switch (result) {
      case 'LINKED':
        return 'Subscribed! You will get alerts about your bookings here.';
      case 'ALREADY_LINKED':
        return 'This chat is already subscribed.';
      case 'CHAT_IN_USE':
        return 'This Telegram chat is already linked to another account.';
      case 'INVALID_CODE':
        return 'This link is invalid or has expired. Create a new one from the app.';
    }
  }

  /** A failed reply must not fail the update (the inbox row is already written). */
  private async reply(chatId: string, text: string): Promise<void> {
    try {
      await this.bot.sendMessage(chatId, text);
    } catch (err) {
      this.logger.warn(
        `Telegram reply not delivered: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
    }
  }
}
