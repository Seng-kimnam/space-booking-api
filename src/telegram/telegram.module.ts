import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { OtpService } from '../users/otp.service';
import { UsersModule } from '../users/users.module';
import { TELEGRAM_LINK_CODES } from './telegram.ports';
import { TelegramController } from './controllers/telegram.controller';
import { TelegramWebhookController } from './controllers/telegram-webhook.controller';
import { TelegramAccount } from './entities/telegram-account.entity';
import { TelegramSecretGuard } from './guards/telegram-secret.guard';
import { TelegramAccountsService } from './services/telegram-accounts.service';
import { TelegramUpdatesService } from './services/telegram-updates.service';
import { TelegramBotClient } from './telegram-bot.client';
import { TelegramWebhookRegistrar } from './telegram-webhook.registrar';

/**
 * TELEGRAM_LINK_CODES is the users module's OtpService; INBOX is bound to
 * InboxService by the global MessagingModule (see telegram.ports.ts).
 */
@Module({
  imports: [TypeOrmModule.forFeature([TelegramAccount]), AuthModule, UsersModule],
  controllers: [TelegramController, TelegramWebhookController],
  providers: [
    { provide: TELEGRAM_LINK_CODES, useExisting: OtpService },
    TelegramBotClient,
    TelegramAccountsService,
    TelegramUpdatesService,
    TelegramSecretGuard,
    TelegramWebhookRegistrar,
  ],
  exports: [TelegramBotClient, TelegramAccountsService],
})
export class TelegramModule {}
