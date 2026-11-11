import { Global, Module, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { DataSource } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm';
import { NO_SHOW_COUNTER, OUTBOX } from '../../src/bookings/bookings.ports';
import type {
  NoShowCounterPort,
  OutboxPort,
  PlaceRulesPort,
} from '../../src/bookings/bookings.ports';
import { OutboxEvent } from '../../src/messaging/entities/outbox-event.entity';
import { BookingPolicy } from '../../src/places/entities/booking-policy.entity';
import { Place } from '../../src/places/entities/place.entity';
import { INBOX, TELEGRAM_LINK_CODES } from '../../src/telegram/telegram.ports';

/**
 * TEST-ONLY stand-ins for the ports that teammates' modules will provide
 * (users, messaging; seats and places are real now). Real SQL on the real test database, so the
 * bookings module is exercised end to end. Not a substitute for those modules:
 * opening hours are not checked here (always open).
 */
/**
 * BookingsModule binds PLACE_RULES to the real PlacesService, which a global
 * module can't shadow, so tests that want "always open" override the token:
 *   .overrideProvider(PLACE_RULES).useFactory({ factory: testPlaceRules, inject: [DataSource] })
 */
export function testPlaceRules(ds: DataSource): PlaceRulesPort {
  return {
    async getBookingContext(placeId, manager?: EntityManager) {
      const m = manager ?? ds.manager;
      const place = await m.getRepository(Place).findOneBy({ id: placeId });
      const policy = await m
        .getRepository(BookingPolicy)
        .findOneBy({ placeId });
      if (!place || !policy) throw new NotFoundException('Place not found');
      return { placeId, name: place.name, timezone: place.timezone, policy };
    },
    isOpenForRange: async () => true,
  };
}

const noShowCounter: NoShowCounterPort = {
  async incrementNoShow(manager, userId) {
    await manager.query(
      'UPDATE users SET no_show_count = no_show_count + 1 WHERE id = $1',
      [userId],
    );
  },
};

const outbox: OutboxPort = {
  async add(manager, event) {
    // QueryDeepPartialEntity can't express a free-form jsonb Record; the fields match the entity.
    await manager
      .getRepository(OutboxEvent)
      .insert(event as unknown as QueryDeepPartialEntity<OutboxEvent>);
  },
};

@Global()
@Module({
  providers: [
    { provide: NO_SHOW_COUNTER, useValue: noShowCounter },
    { provide: OUTBOX, useValue: outbox },
    {
      provide: TELEGRAM_LINK_CODES,
      useValue: { issue: jest.fn(), consume: jest.fn() },
    },
    { provide: INBOX, useValue: { handleOnce: jest.fn() } },
  ],
  exports: [NO_SHOW_COUNTER, OUTBOX, TELEGRAM_LINK_CODES, INBOX],
})
export class TestPortsModule {}
