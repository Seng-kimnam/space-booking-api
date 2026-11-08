import { Global, Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { INBOX, TELEGRAM_LINK_CODES } from '../telegram/telegram.ports';
import { NO_SHOW_COUNTER, OUTBOX, PLACE_RULES } from './bookings.ports';
import {
  interimInbox,
  interimLinkCodes,
  interimNoShowCounter,
  interimOutbox,
  interimPlaceRules,
} from './interim-ports';

/**
 * INTERIM: providers for ports whose owners haven't merged yet. Remove each
 * binding when its real module lands, and this module (plus its AppModule
 * import) once all have:
 *   PLACE_RULES         -> places module
 *   NO_SHOW_COUNTER     -> UsersService
 *   OUTBOX, INBOX       -> messaging module
 *   TELEGRAM_LINK_CODES -> OtpService
 * Global because both the bookings and telegram modules consume these ports.
 */
@Global()
@Module({
  providers: [
    { provide: PLACE_RULES, useFactory: interimPlaceRules, inject: [DataSource] },
    { provide: NO_SHOW_COUNTER, useValue: interimNoShowCounter },
    { provide: OUTBOX, useValue: interimOutbox },
    { provide: TELEGRAM_LINK_CODES, useFactory: interimLinkCodes, inject: [DataSource] },
    { provide: INBOX, useFactory: interimInbox, inject: [DataSource] },
  ],
  exports: [PLACE_RULES, NO_SHOW_COUNTER, OUTBOX, TELEGRAM_LINK_CODES, INBOX],
})
export class InterimPortsModule {}
