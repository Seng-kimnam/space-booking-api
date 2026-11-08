import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { configurations, databaseConfig } from './configuration';
import { UsersModule } from './users/users.module';
import { RolesModule } from './roles/roles.module';
import { SeatsModule } from './seats/seats.module';
import { AppController } from './app.controller';
import { BookingsModule } from './bookings/bookings.module';
import { InterimPortsModule } from './bookings/interim-ports.module';
import { JobsModule } from './jobs/jobs.module';
import { NotificationsModule } from './notifications/notifications.module';
import { TelegramModule } from './telegram/telegram.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: configurations }),
    TypeOrmModule.forRootAsync({
      inject: [databaseConfig.KEY],
      useFactory: (db: ConfigType<typeof databaseConfig>) => db,
    }),
    // Runs the expiry, overdue and notification-dispatch crons (JobsModule).
    ScheduleModule.forRoot(),
    UsersModule,
    RolesModule,
    AuthModule,
    SeatsModule,
    // INTERIM: places/messaging/OTP/no-show providers until those modules merge.
    InterimPortsModule,
    TelegramModule,
    NotificationsModule,
    BookingsModule,
    JobsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
