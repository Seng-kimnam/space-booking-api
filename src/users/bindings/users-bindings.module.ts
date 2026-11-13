import { Global, Module } from '@nestjs/common';
import { ExternalIdentitiesModule } from '../../external-identities/external-identities.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { UserNotificationsService } from '../../notifications/services/user-notifications.service';
import { TelegramModule } from '../../telegram/telegram.module';
import { LINKED_ACCOUNTS, USER_NOTIFICATIONS } from '../users.ports';
import { LinkedAccountsService } from './linked-accounts.service';

/**
 * Binds ports the users module declares (src/users/users.ports.ts) to modules
 * that import UsersModule and so can't be imported by it:
 *   USER_NOTIFICATIONS -> UserNotificationsService (notifications)
 *   LINKED_ACCOUNTS    -> LinkedAccountsService    (telegram + external identities)
 * USER_BOOKINGS is bound by BookingsBindingsModule. Imported only by AppModule.
 */
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
