import { DataSource, EntityManager } from 'typeorm';
import { BookingStatus } from '../../common/enums';
import type { NotificationsService } from '../../notifications/services/notifications.service';
import type { NoShowCounterPort } from '../bookings.ports';
import { Booking } from '../entities/booking.entity';
import type { BookingsRepository } from '../repositories/bookings.repository';
import type { BookingActivityService } from './booking-activity.service';
import { BookingLifecycleService } from './booking-lifecycle.service';
import type { BookingQrService } from './booking-qr.service';

const manager = {} as EntityManager;
const dataSource = {
  transaction: (fn: (m: EntityManager) => Promise<unknown>) => fn(manager),
} as unknown as DataSource;

function booking(id: string, groupId: string | null, userId = 'u1'): Booking {
  return Object.assign(new Booking(), {
    id,
    groupId,
    userId,
    status: BookingStatus.PENDING,
    timeRange: { start: new Date(), end: new Date() },
    seat: { label: id, place: { name: 'P', timezone: 'UTC' } },
  });
}

function setup(due: Booking[], settledGroups: string[] = []) {
  const repo = {
    claimExpirable: jest.fn().mockResolvedValue(due),
    updateFields: jest.fn(),
    noShowAlreadySettled: jest.fn(async (_m: EntityManager, groupId: string) =>
      settledGroups.includes(groupId),
    ),
  };
  const noShows: NoShowCounterPort = { incrementNoShow: jest.fn() };
  const svc = new BookingLifecycleService(
    dataSource,
    repo as unknown as BookingsRepository,
    {
      alertPayload: () => ({}),
      record: jest.fn(),
    } as unknown as BookingActivityService,
    { revokeLive: jest.fn() } as unknown as BookingQrService,
    {
      skipPending: jest.fn(),
      schedule: jest.fn(),
    } as unknown as NotificationsService,
    noShows,
  );
  return { svc, repo, noShows };
}

describe('BookingLifecycleService.expireDue: no-show counting', () => {
  it('counts one no-show per group in a run', async () => {
    const { svc, noShows } = setup([booking('a', 'g1'), booking('b', 'g1')]);
    await svc.expireDue(new Date());
    expect(noShows.incrementNoShow).toHaveBeenCalledTimes(1);
  });

  it('does not count a group again when an earlier run already expired part of it', async () => {
    const { svc, repo, noShows } = setup([booking('b', 'g1')], ['g1']);
    await svc.expireDue(new Date());
    expect(repo.noShowAlreadySettled).toHaveBeenCalledWith(manager, 'g1', [
      'b',
    ]);
    expect(noShows.incrementNoShow).not.toHaveBeenCalled();
  });

  it('counts other groups of the same run normally', async () => {
    const { svc, noShows } = setup(
      [booking('a', 'g1', 'u1'), booking('b', 'g2', 'u2')],
      ['g1'],
    );
    await svc.expireDue(new Date());
    expect(noShows.incrementNoShow).toHaveBeenCalledTimes(1);
    expect(noShows.incrementNoShow).toHaveBeenCalledWith(manager, 'u2');
  });

  it('checks groups in a stable order (advisory locks never deadlock)', async () => {
    const { svc, repo } = setup([booking('a', 'g2'), booking('b', 'g1')]);
    await svc.expireDue(new Date());
    expect(repo.noShowAlreadySettled.mock.calls.map((c) => c[1])).toEqual([
      'g1',
      'g2',
    ]);
  });
});
