import { NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import type { PlaceRulesPort } from '../../bookings/bookings.ports';
import { BookingPolicy } from '../entities/booking-policy.entity';
import { Place } from '../entities/place.entity';
import { OpeningHoursService } from './opening-hours.service';
import { PlaceRulesService } from './place-rules.service';

// Compile-time check: useExisting bindings aren't type-checked, so assert the shape here.
const _port: PlaceRulesPort = {} as PlaceRulesService;
void _port;

const place = { id: 'p', name: 'Lib', timezone: 'Asia/Phnom_Penh' } as Place;
const policy = { placeId: 'p' } as BookingPolicy;

const managerWith = (p: Place | null, pol: BookingPolicy | null) =>
  ({
    findOneBy: async (entity: unknown) => (entity === Place ? p : pol),
  }) as unknown as EntityManager;

describe('PlaceRulesService', () => {
  const svc = (m: EntityManager, hours = {} as OpeningHoursService) =>
    new PlaceRulesService({ manager: m } as unknown as DataSource, hours);

  it('getBookingContext returns place and policy', async () => {
    await expect(
      svc(managerWith(place, policy)).getBookingContext('p'),
    ).resolves.toEqual({
      placeId: 'p',
      name: 'Lib',
      timezone: 'Asia/Phnom_Penh',
      policy,
    });
  });

  it('getBookingContext 404s without a visible place or a policy', async () => {
    await expect(
      svc(managerWith(null, policy)).getBookingContext('p'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      svc(managerWith(place, null)).getBookingContext('p'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('getBookingContext reads on the caller manager when given', async () => {
    const callerManager = managerWith(place, policy);
    const s = svc(managerWith(null, null));
    await expect(
      s.getBookingContext('p', callerManager),
    ).resolves.toMatchObject({ placeId: 'p' });
  });

  it('isOpenForRange passes start, end and manager through', async () => {
    const isOpenForRange = jest.fn(async () => true);
    const m = {} as EntityManager;
    const range = { start: new Date(1), end: new Date(2) };
    const s = svc(managerWith(null, null), {
      isOpenForRange,
    } as unknown as OpeningHoursService);
    await expect(s.isOpenForRange('p', range, m)).resolves.toBe(true);
    expect(isOpenForRange).toHaveBeenCalledWith('p', range.start, range.end, m);
  });
});
