import { Global, Module } from '@nestjs/common';
import { ExternalIdentitiesModule } from '../../external-identities/external-identities.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { UserNotificationsService } from '../../notifications/services/user-notifications.service';
import { TelegramModule } from '../../telegram/telegram.module';
import { LINKED_ACCOUNTS, USER_NOTIFICATIONS } from '../users.ports';
import { LinkedAccountsService } from './linked-accounts.service';

/** Binds USER_NOTIFICATIONS and LINKED_ACCOUNTS (users.ports.ts). Imported by AppModule only. */
@Global()
@Module({
  imports: [NotificationsModule, TelegramModule, ExternalIdentitiesModule],
  providers: [
    LinkedAccountsService,
    { provide: USER_NOTIFICATIONS, useExisting: UserNotificationsService },
    { provide: LINKED_ACCOUNTS, useExisting: LinkedAccountsService },
  ],
  exports: [USER_NOTIFICATIONS, LINKED_ACCOUNTS],
})
export class UsersBindingsModule {}
