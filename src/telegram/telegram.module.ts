import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { TelegramController } from './controllers/telegram.controller';
import { TelegramWebhookController } from './controllers/telegram-webhook.controller';
import { TelegramAccount } from './entities/telegram-account.entity';
import { TelegramSecretGuard } from './guards/telegram-secret.guard';
import { TelegramAccountsService } from './services/telegram-accounts.service';
import { TelegramUpdatesService } from './services/telegram-updates.service';
import { TelegramBotClient } from './telegram-bot.client';
import { TelegramWebhookRegistrar } from './telegram-webhook.registrar';

/**
 * Needs two providers from teammates' modules before it can be added to
 * AppModule (see telegram.ports.ts):
 *   imports:   [UsersModule, MessagingModule],
 *   providers: [{ provide: TELEGRAM_LINK_CODES, useExisting: OtpService },
 *               { provide: INBOX, useExisting: InboxService }]
 */
@Module({
  imports: [TypeOrmModule.forFeature([TelegramAccount]), AuthModule],
  controllers: [TelegramController, TelegramWebhookController],
  providers: [
    TelegramBotClient,
    TelegramAccountsService,
    TelegramUpdatesService,
    TelegramSecretGuard,
    TelegramWebhookRegistrar,
  ],
  exports: [TelegramBotClient, TelegramAccountsService],
})
export class TelegramModule {}
