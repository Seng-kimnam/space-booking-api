import { Global, Module, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { DataSource } from 'typeorm';
import {
  NO_SHOW_COUNTER,
  OUTBOX,
  PLACE_RULES,
  SEAT_LOOKUP,
} from '../../src/bookings/bookings.ports';
import type {
  NoShowCounterPort,
  OutboxPort,
  PlaceRulesPort,
  SeatLookupPort,
} from '../../src/bookings/bookings.ports';
import { OutboxEvent } from '../../src/messaging/entities/outbox-event.entity';
import { BookingPolicy } from '../../src/places/entities/booking-policy.entity';
import { Place } from '../../src/places/entities/place.entity';
import { INBOX, TELEGRAM_LINK_CODES } from '../../src/telegram/telegram.ports';

/**
 * TEST-ONLY stand-ins for the ports that teammates' modules will provide
 * (seats, places, users, messaging). Real SQL on the real test database, so the
 * bookings module is exercised end to end. Not a substitute for those modules:
 * opening hours are not checked here (always open).
 */
function seatLookup(ds: DataSource): SeatLookupPort {
  return {
    async findBookable(seatIds, manager) {
      const rows: { id: string; place_id: string; label: string }[] = await (
        manager ?? ds.manager
      ).query(
        `SELECT s.id, s.place_id, s.label
           FROM seats s JOIN places p ON p.id = s.place_id
          WHERE s.id = ANY($1::uuid[]) AND s.status = 'ACTIVE' AND s.deleted_at IS NULL
            AND p.is_active AND p.deleted_at IS NULL`,
        [seatIds],
      );
      return rows.map((r) => ({ id: r.id, placeId: r.place_id, label: r.label }));
    },
  };
}

function placeRules(ds: DataSource): PlaceRulesPort {
  return {
    async getBookingContext(placeId, manager?: EntityManager) {
      const m = manager ?? ds.manager;
      const place = await m.getRepository(Place).findOneBy({ id: placeId });
      const policy = await m.getRepository(BookingPolicy).findOneBy({ placeId });
      if (!place || !policy) throw new NotFoundException('Place not found');
      return { placeId, name: place.name, timezone: place.timezone, policy };
    },
    isOpenForRange: async () => true,
  };
}

const noShowCounter: NoShowCounterPort = {
  async incrementNoShow(manager, userId) {
    await manager.query('UPDATE users SET no_show_count = no_show_count + 1 WHERE id = $1', [userId]);
  },
};

const outbox: OutboxPort = {
  async add(manager, event) {
    await manager.getRepository(OutboxEvent).insert(event);
  },
};

@Global()
@Module({
  providers: [
    { provide: SEAT_LOOKUP, useFactory: seatLookup, inject: [DataSource] },
    { provide: PLACE_RULES, useFactory: placeRules, inject: [DataSource] },
    { provide: NO_SHOW_COUNTER, useValue: noShowCounter },
    { provide: OUTBOX, useValue: outbox },
    { provide: TELEGRAM_LINK_CODES, useValue: { issue: jest.fn(), consume: jest.fn() } },
    { provide: INBOX, useValue: { handleOnce: jest.fn() } },
  ],
  exports: [SEAT_LOOKUP, PLACE_RULES, NO_SHOW_COUNTER, OUTBOX, TELEGRAM_LINK_CODES, INBOX],
})
export class TestPortsModule {}
