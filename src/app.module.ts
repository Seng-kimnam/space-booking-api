import { Module } from '@nestjs/common';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { BookingsModule } from './bookings/bookings.module';
import { configurations, databaseConfig } from './configuration';
import { DevModule } from './dev/dev.module';
import { JobsModule } from './jobs/jobs.module';
import { NotificationsModule } from './notifications/notifications.module';
import { TelegramModule } from './telegram/telegram.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    // Global: database, redis and mail config are injectable in every module.
    ConfigModule.forRoot({ isGlobal: true, load: configurations }),
    TypeOrmModule.forRootAsync({
      inject: [databaseConfig.KEY],
      useFactory: (db: ConfigType<typeof databaseConfig>) => db,
    }),
    ScheduleModule.forRoot(),
    // TEMPORARY: stand-ins for teammates' modules + dev login. See src/dev/dev.module.ts.
    DevModule,
    UsersModule,
    TelegramModule,
    NotificationsModule,
    BookingsModule,
    JobsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
