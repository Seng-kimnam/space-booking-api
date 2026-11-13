import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  configurations,
  databaseConfig,
  validateEnv,
} from './configuration';
import { UsersModule } from './users/users.module';
import { RolesModule } from './roles/roles.module';
import { PlacesModule } from './places/places.module';
import { AreasModule } from './areas/areas.module';
import { SeatsModule } from './seats/seats.module';
import { AppController } from './app.controller';
import { BookingsModule } from './bookings/bookings.module';
import { InterimPortsModule } from './bookings/interim-ports.module';
import { BookingsBindingsModule } from './bookings/bookings-bindings.module';
import { JobsModule } from './jobs/jobs.module';
import { MessagingModule } from './messaging/messaging.module';
import { LibraryIntegrationModule } from './integrations/library/library-integration.module';
import { ApiClientsModule } from './api-clients/api-clients.module';
import { NotificationsModule } from './notifications/notifications.module';
import { TelegramModule } from './telegram/telegram.module';

@Module({
  imports: [
    // validate: the app refuses to start with a missing or invalid env var.
    ConfigModule.forRoot({
      isGlobal: true,
      load: configurations,
      validate: validateEnv,
    }),
    TypeOrmModule.forRootAsync({
      inject: [databaseConfig.KEY],
      useFactory: (db: ConfigType<typeof databaseConfig>) => db,
    }),
    // Runs the expiry, overdue and notification-dispatch crons (JobsModule).
    ScheduleModule.forRoot(),
    UsersModule,
    RolesModule,
    AuthModule,
    PlacesModule,
    AreasModule,
    SeatsModule,
    // OUTBOX port + RabbitMQ publisher (outbox relay runs in JobsModule).
    MessagingModule,
    // INTERIM: OTP/no-show providers until those modules merge.
    InterimPortsModule,
    TelegramModule,
    NotificationsModule,
    BookingsModule,
    // Ports places/seats declare and bookings implements (global).
    BookingsBindingsModule,
    JobsModule,
    // Integrating systems calling us with an API key (/admin/api-clients, ApiKeyGuard).
    ApiClientsModule,
    // LMS: place sync consumer (off unless LIBRARY_INTEGRATION_ENABLED=true),
    // LMS HTTP client + repair job (off unless LMS_BASE_URL is set).
    LibraryIntegrationModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
