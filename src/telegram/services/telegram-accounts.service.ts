import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { OtpPurpose } from '../../common/enums';
import { isPgError, PG_UNIQUE_VIOLATION } from '../../common/utils/db-errors';
import { telegramConfig } from '../../configuration/telegram.config';
import { TelegramAccount } from '../entities/telegram-account.entity';
import { TelegramBotClient } from '../telegram-bot.client';
import { TELEGRAM_LINK_CODES } from '../telegram.ports';
import type { LinkCodesPort } from '../telegram.ports';

export type LinkChatResult =
  'LINKED' | 'ALREADY_LINKED' | 'INVALID_CODE' | 'CHAT_IN_USE';

export interface TelegramStatus {
  linked: boolean;
  username: string | null;
  linkedAt: Date | null;
}

/**
 * One live Telegram chat per user and one user per chat (partial unique indexes
 * on telegram_accounts). Unlinked rows are kept for history.
 */
@Injectable()
export class TelegramAccountsService {
  private readonly logger = new Logger(TelegramAccountsService.name);

  constructor(
    @InjectRepository(TelegramAccount)
    private readonly accounts: Repository<TelegramAccount>,
    @Inject(TELEGRAM_LINK_CODES)
    private readonly linkCodes: LinkCodesPort,
    private readonly bot: TelegramBotClient,
    private readonly dataSource: DataSource,
    @Inject(telegramConfig.KEY)
    private readonly config: ConfigType<typeof telegramConfig>,
  ) {}

  /** Deep link the user opens to subscribe: https://t.me/<bot>?start=<code>. */
  async createLink(userId: string): Promise<{ url: string; expiresAt: Date }> {
    if (!this.config.botUsername || !this.bot.isConfigured) {
      throw new ServiceUnavailableException('Telegram is not configured');
    }
    if (await this.findLive(userId)) {
      throw new ConflictException(
        'Telegram is already linked. Unlink it before linking another chat.',
      );
    }
    const { code, expiresAt } = await this.linkCodes.issue(
      userId,
      OtpPurpose.TELEGRAM_LINK,
      this.config.linkTtlMinutes,
    );
    // Never log the code or the URL: the code links a chat to this account.
    this.logger.log(`Telegram link code issued: user=${userId}`);
    return {
      url: `https://t.me/${this.config.botUsername}?start=${encodeURIComponent(code)}`,
      expiresAt,
    };
  }

  async getStatus(userId: string): Promise<TelegramStatus> {
    const account = await this.findLive(userId);
    return {
      linked: account !== null,
      username: account?.username ?? null,
      linkedAt: account?.linkedAt ?? null,
    };
  }

  /** Idempotent: unlinking when nothing is linked is a no-op. */
  async unlink(userId: string): Promise<void> {
    const account = await this.findLive(userId);
    if (!account) return;
    await this.accounts.update(
      { id: account.id, unlinkedAt: IsNull() },
      { unlinkedAt: new Date() },
    );
    this.logger.log(`Telegram unlinked from the app: user=${userId}`);
    await this.sendSafely(
      account.chatId,
      'You have unsubscribed from Space Booking alerts. Link again from the app at any time.',
    );
  }

  /** Used by the Telegram notification channel. */
  async findLiveChatId(userId: string): Promise<string | null> {
    const account = await this.findLive(userId);
    return account?.chatId ?? null;
  }

  /** Called from the webhook when the user presses Start on the deep link. */
  async linkChat(
    code: string,
    chatId: string,
    username: string | null,
  ): Promise<LinkChatResult> {
    const userId = await this.linkCodes.consume(code, OtpPurpose.TELEGRAM_LINK);
    if (!userId) {
      this.logger.warn('Telegram link rejected: invalid, used or expired code');
      return 'INVALID_CODE';
    }

    const result = await this.linkChatForUser(userId, chatId, username);
    if (result === 'LINKED') {
      this.logger.log(`Telegram linked: user=${userId}`);
    } else if (result === 'CHAT_IN_USE') {
      this.logger.warn(
        `Telegram link rejected: chat already linked to another account (user=${userId})`,
      );
    }
    return result;
  }

  private async linkChatForUser(
    userId: string,
    chatId: string,
    username: string | null,
  ): Promise<LinkChatResult> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const repo = manager.getRepository(TelegramAccount);
        const chatOwner = await repo.findOne({
          where: { chatId, unlinkedAt: IsNull() },
        });
        if (chatOwner) {
          return chatOwner.userId === userId ? 'ALREADY_LINKED' : 'CHAT_IN_USE';
        }
        // One live chat per user: a new chat replaces the old one.
        await repo.update(
          { userId, unlinkedAt: IsNull() },
          { unlinkedAt: new Date() },
        );
        await repo.insert({ userId, chatId, username });
        return 'LINKED';
      });
    } catch (err) {
      // A concurrent link of the same chat lost the race on the unique index.
      if (isPgError(err, PG_UNIQUE_VIOLATION)) return 'CHAT_IN_USE';
      throw err;
    }
  }

  /** The user left from Telegram (/stop or blocked the bot). Returns true if a link was removed. */
  async unlinkChat(chatId: string): Promise<boolean> {
    // RETURNING user_id: the log names the user, never the Telegram chat id.
    const result = await this.accounts
      .createQueryBuilder()
      .update(TelegramAccount)
      .set({ unlinkedAt: () => 'now()' })
      .where('chat_id = :chatId AND unlinked_at IS NULL', { chatId })
      .returning('user_id')
      .execute();
    const rows = result.raw as { user_id: string }[];
    for (const row of rows) {
      this.logger.log(
        `Telegram unlinked from Telegram (/stop, blocked or chat gone): user=${row.user_id}`,
      );
    }
    return rows.length > 0;
  }

  async isChatLinked(chatId: string): Promise<boolean> {
    return this.accounts.exists({ where: { chatId, unlinkedAt: IsNull() } });
  }

  private findLive(userId: string): Promise<TelegramAccount | null> {
    return this.accounts.findOne({ where: { userId, unlinkedAt: IsNull() } });
  }

  private async sendSafely(chatId: string, text: string): Promise<void> {
    try {
      await this.bot.sendMessage(chatId, text);
    } catch (err) {
      this.logger.warn(
        `Telegram message not delivered: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
    }
  }
}
