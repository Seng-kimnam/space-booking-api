import { EntityManager } from 'typeorm';
import type { PlaceRulesPort } from '../bookings.ports';
import { Booking } from '../entities/booking.entity';
import type { BookingsRepository } from '../repositories/bookings.repository';
import type { BookingCancellationService } from './booking-cancellation.service';
import { PlaceChangeBookingsService } from './place-change-bookings.service';

const manager = {} as EntityManager;
const at = (iso: string) => new Date(iso);

function booking(id: string, startIso: string): Booking {
  const start = at(startIso);
  return Object.assign(new Booking(), {
    id,
    timeRange: { start, end: new Date(start.getTime() + 3_600_000) },
  });
}

function setup(pending: Booking[], openIds: string[] = []) {
  const repo = { lockPendingAtPlace: jest.fn().mockResolvedValue(pending) };
  const cancellation = { cancelForPlaceChange: jest.fn().mockResolvedValue(7) };
  const rules = {
    isOpenForRange: jest.fn(async (_p: string, range: { start: Date }) =>
      pending.some(
        (b) => openIds.includes(b.id) && b.timeRange.start === range.start,
      ),
    ),
  };
  const svc = new PlaceChangeBookingsService(
    repo as unknown as BookingsRepository,
    cancellation as unknown as BookingCancellationService,
    rules as unknown as PlaceRulesPort,
  );
  return { svc, repo, cancellation, rules };
}

describe('PlaceChangeBookingsService', () => {
  const now = at('2026-11-09T00:00:00.000Z');

  it('cancels every PENDING booking on a seat, as an admin cancellation', async () => {
    const { svc, repo, cancellation } = setup([
      booking('a', '2026-11-09T03:00:00.000Z'),
    ]);
    const n = await svc.cancelAffected(
      manager,
      'p1',
      { seatId: 's1' },
      'SEAT_UNAVAILABLE',
      now,
    );
    expect(repo.lockPendingAtPlace).toHaveBeenCalledWith(manager, 'p1', 's1');
    expect(cancellation.cancelForPlaceChange).toHaveBeenCalledWith(
      manager,
      [{ bookingId: 'a', subReason: 'SEAT_UNAVAILABLE' }],
      now,
      'ADMIN_CANCELLED',
    );
    expect(n).toBe(7);
  });

  it("'all' takes every PENDING booking of the place", async () => {
    const { svc, repo } = setup([]);
    await svc.cancelAffected(manager, 'p1', 'all', 'PLACE_DELETED', now);
    expect(repo.lockPendingAtPlace).toHaveBeenCalledWith(
      manager,
      'p1',
      undefined,
    );
  });

  it("'outside-hours' cancels only bookings the new hours no longer allow", async () => {
    const { svc, cancellation, rules } = setup(
      [
        booking('open', '2026-11-09T03:00:00.000Z'),
        booking('closed', '2026-11-10T03:00:00.000Z'),
      ],
      ['open'],
    );
    await svc.cancelAffected(
      manager,
      'p1',
      'outside-hours',
      'HOURS_CHANGED',
      now,
    );
    expect(rules.isOpenForRange).toHaveBeenCalledTimes(2);
    expect(cancellation.cancelForPlaceChange).toHaveBeenCalledWith(
      manager,
      [{ bookingId: 'closed', subReason: 'HOURS_CHANGED' }],
      now,
      'ADMIN_CANCELLED',
    );
  });
});
