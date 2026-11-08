import { Global, Inject, Module, OnModuleInit, ValidationPipe } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { APP_GUARD, APP_PIPE } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { NO_SHOW_COUNTER, OUTBOX, PLACE_RULES, SEAT_LOOKUP } from '../bookings/bookings.ports';
import { appConfig } from '../configuration';
import { INBOX, TELEGRAM_LINK_CODES } from '../telegram/telegram.ports';
import { DevAuthGuard } from './dev-auth.guard';
import {
  devInbox,
  devLinkCodes,
  devNoShowCounter,
  devOutbox,
  devPlaceRules,
  devSeatLookup,
} from './dev-ports';

const PORTS = [SEAT_LOOKUP, PLACE_RULES, NO_SHOW_COUNTER, OUTBOX, TELEGRAM_LINK_CODES, INBOX];

/**
 * TEMPORARY wiring so the bookings, notifications and telegram endpoints can be
 * run and tried in Swagger before the auth, places, seats, users and messaging
 * modules merge. Remove a provider as soon as its real owner provides it, and
 * remove this whole module (and its import in AppModule) once all have.
 */
@Global()
@Module({
  providers: [
    { provide: SEAT_LOOKUP, useFactory: devSeatLookup, inject: [DataSource] },
    { provide: PLACE_RULES, useFactory: devPlaceRules, inject: [DataSource] },
    { provide: NO_SHOW_COUNTER, useValue: devNoShowCounter },
    { provide: OUTBOX, useValue: devOutbox },
    { provide: TELEGRAM_LINK_CODES, useFactory: devLinkCodes, inject: [DataSource] },
    { provide: INBOX, useFactory: devInbox, inject: [DataSource] },
    // Dev login (Bearer <user id>) until the auth module's global JWT guard exists.
    { provide: APP_GUARD, useClass: DevAuthGuard },
    // Belongs in main.ts / common long-term (AGENTS.md section 8).
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    },
  ],
  exports: PORTS,
})
export class DevModule implements OnModuleInit {
  constructor(@Inject(appConfig.KEY) private readonly app: ConfigType<typeof appConfig>) {}

  onModuleInit(): void {
    // The dev login trusts any user id: never let it run in production.
    if (this.app.nodeEnv === 'production') {
      throw new Error('DevModule must not be loaded in production');
    }
  }
}
