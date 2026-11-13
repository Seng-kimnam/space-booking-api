import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TelegramModule } from '../telegram/telegram.module';
import {
  NOTIFICATION_CHANNEL_STRATEGIES,
  NotificationChannelStrategy,
} from './channels/notification-channel.strategy';
import { TelegramChannel } from './channels/telegram.channel';
import { Notification } from './entities/notification.entity';
import { NotificationsRepository } from './repositories/notifications.repository';
import { NotificationDispatcher } from './services/notification-dispatcher.service';
import { NotificationsService } from './services/notifications.service';
import { UserNotificationsService } from './services/user-notifications.service';

@Module({
  imports: [TypeOrmModule.forFeature([Notification]), TelegramModule],
  providers: [
    NotificationsRepository,
    NotificationsService,
    NotificationDispatcher,
    UserNotificationsService,
    TelegramChannel,
    // Register every channel strategy here (e.g. add EmailChannel to `inject`).
    {
      provide: NOTIFICATION_CHANNEL_STRATEGIES,
      useFactory: (
        ...strategies: NotificationChannelStrategy[]
      ): NotificationChannelStrategy[] => strategies,
      inject: [TelegramChannel],
    },
  ],
  exports: [NotificationsService, NotificationDispatcher, UserNotificationsService],
})
export class NotificationsModule {}
