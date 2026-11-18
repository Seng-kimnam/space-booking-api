import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager, QueryFailedError, Repository } from 'typeorm';
import { BookingPolicy } from '../entities/booking-policy.entity';
import { PlaceClosure } from '../entities/place-closure.entity';
import { PlaceOpeningHour } from '../entities/place-opening-hour.entity';
import { Place } from '../entities/place.entity';
import type { OutboxService } from '../../messaging/outbox/outbox.service';
import type { PlaceChangeBookingsPort } from '../places.ports';
import {
  PlacesService,
  definedOnly,
  mapDbError,
} from './places.service';
import { escapeLike } from '../../common/utils/pagination';

const dbError = (code: string, constraint: string) =>
  Object.assign(new QueryFailedError('q', [], new Error('x')), {
    driverError: { code, constraint },
  });

// Only the bits a test touches are faked.
function service(opts: {
  place?: Partial<Place> | null;
  policy?: Partial<BookingPolicy> | null;
  saved?: object[];
  failWith?: unknown;
  bookingChanges?: PlaceChangeBookingsPort;
}) {
  const saved = opts.saved ?? [];
  const manager = {
    createQueryBuilder: () => ({
      setLock() {
        return this;
      },
      where() {
        return this;
      },
      getOne: async () => opts.place ?? null,
    }),
    save: async (e: object) => {
      if (opts.failWith) throw opts.failWith;
      saved.push({ ...e });
      return e;
    },
    findOneBy: async () => opts.policy ?? null,
    create: (_: unknown, v: object) => ({ ...v }),
    delete: async () => undefined,
    insert: async () => undefined,
    softDelete: jest.fn(async () => undefined),
  } as unknown as EntityManager;
  const places = {
    manager: {
      transaction: (work: (m: EntityManager) => Promise<unknown>) =>
        work(manager),
    },
    findOneBy: async () => opts.place ?? null,
    softDelete: jest.fn(async () => undefined),
  } as unknown as Repository<Place>;
  const svc = new PlacesService(
    places,
    { find: async () => [] } as unknown as Repository<PlaceOpeningHour>,
    {} as Repository<PlaceClosure>,
    {} as Repository<BookingPolicy>,
    { add: jest.fn(async () => undefined) } as unknown as OutboxService,
    opts.bookingChanges,
  );
  return { svc, places, saved, manager };
}

describe('mapDbError', () => {
  it('maps the policy min/max check to a readable 400', () => {
    const e = mapDbError(dbError('23514', 'booking_policies_max_chk'));
    expect(e).toBeInstanceOf(BadRequestException);
    expect((e as BadRequestException).message).toContain('maxMinutes');
  });

  it('maps other policy checks to 400', () => {
    expect(
      mapDbError(dbError('23514', 'booking_policies_grace_chk')),
    ).toBeInstanceOf(BadRequestException);
  });

  it.each([
    'place_opening_hours_place_weekday_uk',
    'place_closures_place_date_uk',
  ])('maps a %s race to 409', (constraint) => {
    expect(mapDbError(dbError('23505', constraint))).toBeInstanceOf(
      ConflictException,
    );
  });

  it('passes unknown errors through unchanged', () => {
    const other = dbError('23505', 'something_else');
    expect(mapDbError(other)).toBe(other);
    const plain = new Error('boom');
    expect(mapDbError(plain)).toBe(plain);
  });
});

describe('helpers', () => {
  it('escapeLike makes %, _ and \\ literal', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
  });

  it('definedOnly drops undefined but keeps null, 0 and false', () => {
    expect(
      definedOnly({ a: undefined, b: null, c: 0, d: false, e: 'x' }),
    ).toEqual({ b: null, c: 0, d: false, e: 'x' });
  });
});

describe('PlacesService', () => {
  it('update 404s when the place is missing or deleted', async () => {
    await expect(
      service({ place: null }).svc.update('p', { name: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('update never overwrites fields the client left out', async () => {
    const saved: object[] = [];
    const { svc } = service({
      place: { id: 'p', name: 'Old', address: 'Addr', lat: 1 },
      policy: { placeId: 'p', minMinutes: 30, maxMinutes: 240 },
      saved,
    });
    // Detail re-read is outside the unit under test.
    jest.spyOn(svc as never, 'detail').mockResolvedValue({} as never);

    await svc.update('p', {
      name: 'New',
      address: undefined,
      bookingPolicy: { maxMinutes: 120, minMinutes: undefined },
    });

    expect(saved[0]).toMatchObject({ name: 'New', address: 'Addr', lat: 1 });
    expect(saved[1]).toMatchObject({ minMinutes: 30, maxMinutes: 120 });
  });

  it('update maps DB errors raised inside the transaction', async () => {
    const { svc } = service({
      place: { id: 'p' },
      failWith: dbError('23514', 'booking_policies_max_chk'),
    });
    await expect(svc.update('p', { name: 'x' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('softDelete 404s for a missing place and does not delete', async () => {
    const { svc, places } = service({ place: null });
    await expect(svc.softDelete('p')).rejects.toBeInstanceOf(NotFoundException);
    expect(places.softDelete).not.toHaveBeenCalled();
  });

  it('getActivePlace 404s when not found', async () => {
    await expect(
      service({ place: null }).svc.getActivePlace('p'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('PlacesService: bookings an admin change makes impossible', () => {
  const port = () => ({ cancelAffected: jest.fn(async () => 3) });
  const active = { id: 'p', isActive: true, externalSystem: null } as Partial<Place>;

  it('deactivating cancels every PENDING booking of the place', async () => {
    const bookingChanges = port();
    const { svc } = service({ place: { ...active }, bookingChanges });
    jest.spyOn(svc as never, 'detail' as never).mockResolvedValue({} as never);
    await svc.update('p', { isActive: false });
    expect(bookingChanges.cancelAffected).toHaveBeenCalledWith(
      expect.anything(),
      'p',
      'all',
      'PLACE_DEACTIVATED',
    );
  });

  it('new opening hours or closures cancel the bookings they no longer allow', async () => {
    const bookingChanges = port();
    const { svc } = service({ place: { ...active }, bookingChanges });
    jest.spyOn(svc as never, 'detail' as never).mockResolvedValue({} as never);
    await svc.update('p', { closures: [{ date: '2026-12-25' }] });
    expect(bookingChanges.cancelAffected).toHaveBeenCalledWith(
      expect.anything(),
      'p',
      'outside-hours',
      'HOURS_CHANGED',
    );
  });

  it('other edits cancel nothing', async () => {
    const bookingChanges = port();
    const { svc } = service({ place: { ...active }, bookingChanges });
    jest.spyOn(svc as never, 'detail' as never).mockResolvedValue({} as never);
    await svc.update('p', { name: 'Renamed' });
    expect(bookingChanges.cancelAffected).not.toHaveBeenCalled();
  });

  it('delete cancels every PENDING booking in the same transaction', async () => {
    const bookingChanges = port();
    const { svc, manager } = service({ place: { ...active, name: 'Lib' }, bookingChanges });
    await svc.softDelete('p');
    expect(manager.softDelete).toHaveBeenCalledWith(Place, { id: 'p' });
    expect(bookingChanges.cancelAffected).toHaveBeenCalledWith(manager, 'p', 'all', 'PLACE_DELETED');
  });
});
