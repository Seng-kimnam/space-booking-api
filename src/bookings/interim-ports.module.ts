import { Global, Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { INBOX, TELEGRAM_LINK_CODES } from '../telegram/telegram.ports';
import { NO_SHOW_COUNTER, OUTBOX } from './bookings.ports';
import {
  interimInbox,
  interimLinkCodes,
  interimNoShowCounter,
  interimOutbox,
} from './interim-ports';

/**
 * INTERIM: providers for ports whose owners haven't merged yet. Remove each
 * binding when its real module lands, and this module (plus its AppModule
 * import) once all have:
 *   NO_SHOW_COUNTER     -> UsersService
 *   OUTBOX, INBOX       -> messaging module
 *   TELEGRAM_LINK_CODES -> OtpService
 * Global because both the bookings and telegram modules consume these ports.
 */
@Global()
@Module({
  providers: [
    { provide: NO_SHOW_COUNTER, useValue: interimNoShowCounter },
    { provide: OUTBOX, useValue: interimOutbox },
    { provide: TELEGRAM_LINK_CODES, useFactory: interimLinkCodes, inject: [DataSource] },
    { provide: INBOX, useFactory: interimInbox, inject: [DataSource] },
  ],
  exports: [NO_SHOW_COUNTER, OUTBOX, TELEGRAM_LINK_CODES, INBOX],
})
export class InterimPortsModule {}
