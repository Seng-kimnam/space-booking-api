import { Injectable } from '@nestjs/common';
import { NotificationChannel } from '../../common/enums';
import { TelegramAccountsService } from '../../telegram/services/telegram-accounts.service';
import {
  TelegramApiError,
  TelegramBotClient,
} from '../../telegram/telegram-bot.client';
import {
  NotificationChannelStrategy,
  RecipientUnreachableError,
  RenderedNotification,
} from './notification-channel.strategy';

export function escapeTelegramHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function formatForTelegram(message: RenderedNotification): string {
  return `<b>${escapeTelegramHtml(message.title)}</b>\n${escapeTelegramHtml(message.body)}`;
}

@Injectable()
export class TelegramChannel implements NotificationChannelStrategy {
  readonly channel = NotificationChannel.TELEGRAM;

  constructor(
    private readonly accounts: TelegramAccountsService,
    private readonly bot: TelegramBotClient,
  ) {}

  async isAvailableFor(userId: string): Promise<boolean> {
    return (await this.accounts.findLiveChatId(userId)) !== null;
  }

  async send(userId: string, message: RenderedNotification): Promise<void> {
    const chatId = await this.accounts.findLiveChatId(userId);
    if (!chatId) {
      throw new RecipientUnreachableError('No linked Telegram chat');
    }
    try {
      await this.bot.sendMessage(chatId, formatForTelegram(message));
    } catch (err) {
      if (err instanceof TelegramApiError && err.isRecipientGone) {
        // Blocked the bot without us seeing the my_chat_member update: unlink now.
        await this.accounts.unlinkChat(chatId);
        throw new RecipientUnreachableError('User blocked the Telegram bot');
      }
      throw err;
    }
  }
}
