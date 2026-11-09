import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import {
  secretsMatch,
  TelegramSecretGuard,
} from './guards/telegram-secret.guard';
import { TelegramAccountsService } from './services/telegram-accounts.service';
import {
  parseCommand,
  TelegramUpdatesService,
} from './services/telegram-updates.service';
import { TelegramBotClient } from './telegram-bot.client';
import type { InboxPort } from './telegram.ports';
import type { TelegramUpdate } from './telegram.types';

describe('parseCommand', () => {
  it.each([
    ['/start abc_123', { command: '/start', arg: 'abc_123' }],
    ['/start@SpaceBot abc', { command: '/start', arg: 'abc' }],
    ['/STOP', { command: '/stop', arg: '' }],
    ['  /status  ', { command: '/status', arg: '' }],
  ])('parses %p', (text, expected) => {
    expect(parseCommand(text)).toEqual(expected);
  });

  it('ignores plain text', () => {
    expect(parseCommand('hello')).toBeNull();
  });
});

describe('TelegramSecretGuard', () => {
  const context = (header?: string) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ header: () => header }) }),
    }) as unknown as ExecutionContext;
  const guard = (secret: string) =>
    new TelegramSecretGuard({ webhookSecret: secret } as never);

  it('accepts the right secret', () => {
    expect(guard('s3cret').canActivate(context('s3cret'))).toBe(true);
  });

  it.each([['wrong'], [undefined]])('rejects %p', (header) => {
    expect(() => guard('s3cret').canActivate(context(header))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects everything when no secret is configured', () => {
    expect(() => guard('').canActivate(context(''))).toThrow(
      UnauthorizedException,
    );
  });

  it('compares secrets of different lengths safely', () => {
    expect(secretsMatch('a', 'abc')).toBe(false);
  });
});

describe('TelegramUpdatesService', () => {
  function setup() {
    const accounts = {
      linkChat: jest.fn().mockResolvedValue('LINKED'),
      unlinkChat: jest.fn().mockResolvedValue(true),
      isChatLinked: jest.fn().mockResolvedValue(true),
    };
    const bot = { sendMessage: jest.fn().mockResolvedValue(undefined) };
    const seen = new Set<string>();
    const inbox: InboxPort = {
      handleOnce: jest.fn(async (message, handler) => {
        const key = `${message.source}:${message.messageId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        await handler();
        return true;
      }),
    };
    const service = new TelegramUpdatesService(
      accounts as unknown as TelegramAccountsService,
      bot as unknown as TelegramBotClient,
      inbox,
    );
    return { service, accounts, bot, inbox };
  }

  const message = (
    updateId: number,
    text: string,
    type = 'private',
  ): TelegramUpdate => ({
    update_id: updateId,
    message: {
      message_id: 1,
      chat: { id: 42, type: type as 'private' },
      from: { id: 7, is_bot: false, username: 'alice' },
      text,
    },
  });

  it('links the chat on /start <code> and replies', async () => {
    const { service, accounts, bot } = setup();
    await service.handle(message(1, '/start CODE123'));
    expect(accounts.linkChat).toHaveBeenCalledWith('CODE123', '42', 'alice');
    expect(bot.sendMessage).toHaveBeenCalledWith(
      '42',
      expect.stringContaining('Subscribed'),
    );
  });

  it('processes a redelivered update only once', async () => {
    const { service, accounts } = setup();
    await service.handle(message(5, '/start CODE123'));
    await service.handle(message(5, '/start CODE123'));
    expect(accounts.linkChat).toHaveBeenCalledTimes(1);
  });

  it('never stores the link code in the inbox payload', async () => {
    const { service, inbox } = setup();
    await service.handle(message(2, '/start SECRETCODE'));
    const stored = JSON.stringify(
      (inbox.handleOnce as jest.Mock).mock.calls[0][0],
    );
    expect(stored).not.toContain('SECRETCODE');
  });

  it('unlinks on /stop', async () => {
    const { service, accounts } = setup();
    await service.handle(message(3, '/stop'));
    expect(accounts.unlinkChat).toHaveBeenCalledWith('42');
  });

  it('unlinks silently when the user blocks the bot', async () => {
    const { service, accounts, bot } = setup();
    await service.handle({
      update_id: 4,
      my_chat_member: {
        chat: { id: 42, type: 'private' },
        from: { id: 7, is_bot: false },
        new_chat_member: { status: 'kicked' },
      },
    });
    expect(accounts.unlinkChat).toHaveBeenCalledWith('42');
    expect(bot.sendMessage).not.toHaveBeenCalled();
  });

  it('ignores group chats', async () => {
    const { service, accounts, bot } = setup();
    await service.handle(message(6, '/start CODE', 'group'));
    expect(accounts.linkChat).not.toHaveBeenCalled();
    expect(bot.sendMessage).not.toHaveBeenCalled();
  });

  it('still succeeds when the reply fails', async () => {
    const { service, bot } = setup();
    bot.sendMessage.mockRejectedValue(new Error('network'));
    await expect(
      service.handle(message(7, '/start CODE')),
    ).resolves.toBeUndefined();
  });
});
