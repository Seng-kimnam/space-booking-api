import { Global, Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TELEGRAM_LINK_CODES } from '../telegram/telegram.ports';
import { NO_SHOW_COUNTER } from './bookings.ports';
import { interimLinkCodes, interimNoShowCounter } from './interim-ports';

/**
 * INTERIM: providers for ports whose owners haven't merged yet. Remove each
 * binding when its real module lands, and this module (plus its AppModule
 * import) once all have:
 *   NO_SHOW_COUNTER     -> UsersService
 *   TELEGRAM_LINK_CODES -> OtpService
 * OUTBOX and INBOX are bound by MessagingModule (OutboxService, InboxService).
 * Global because both the bookings and telegram modules consume these ports.
 */
@Global()
@Module({
  providers: [
    { provide: NO_SHOW_COUNTER, useValue: interimNoShowCounter },
    { provide: TELEGRAM_LINK_CODES, useFactory: interimLinkCodes, inject: [DataSource] },
  ],
  exports: [NO_SHOW_COUNTER, TELEGRAM_LINK_CODES],
})
export class InterimPortsModule {}
