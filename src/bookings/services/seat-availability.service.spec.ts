import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SeatStatus } from '../../common/enums';
import type { PlaceRulesPort } from '../bookings.ports';
import type { BookingsRepository } from '../repositories/bookings.repository';
import { SeatAvailabilityService } from './seat-availability.service';

const at = (iso: string) => new Date(iso);
const start = at('2026-11-09T03:00:00.000Z');
const end = at('2026-11-09T05:00:00.000Z');

function setup(opts: {
  place?: object | null;
  open?: boolean;
  busy?: { start: Date; end: Date }[];
  occupiedNow?: boolean;
}) {
  const ds = {
    manager: {
      findOneBy: jest
        .fn()
        .mockResolvedValue(
          opts.place === undefined
            ? { id: 'p1', isActive: true, externalOpen: null }
            : opts.place,
        ),
    },
  } as unknown as DataSource;
  const repo = {
    findAvailableSeats: jest
      .fn()
      .mockResolvedValue({ items: [{ id: 's1' }], total: 1 }),
    busyRanges: jest.fn().mockResolvedValue(opts.busy ?? []),
    isOccupiedNow: jest.fn().mockResolvedValue(opts.occupiedNow ?? false),
  };
  const rules = {
    isOpenForRange: jest.fn().mockResolvedValue(opts.open ?? true),
  };
  const svc = new SeatAvailabilityService(
    ds,
    repo as unknown as BookingsRepository,
    rules as unknown as PlaceRulesPort,
  );
  return { svc, repo };
}

const query = { placeId: 'p1', start, end, page: 1, limit: 20 };
const seat = { id: 's1', placeId: 'p1', status: SeatStatus.ACTIVE };

describe('SeatAvailabilityService', () => {
  it.each([
    ['end before start', end, start],
    ['empty window', start, start],
    ['longer than 31 days', start, at('2026-12-11T03:00:00.000Z')],
  ])('400 on %s', async (_l, s, e) => {
    const { svc } = setup({});
    await expect(
      svc.availableSeats({ ...query, start: s, end: e }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.seatAvailability(seat, s, e)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('404 for an unknown or inactive place', async () => {
    const { svc } = setup({ place: null });
    await expect(svc.availableSeats(query)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('nothing is available while the place is closed', async () => {
    const { svc, repo } = setup({ open: false });
    expect(await svc.availableSeats(query)).toEqual({
      items: [],
      total: 0,
      placeOpen: false,
    });
    expect(repo.findAvailableSeats).not.toHaveBeenCalled();
  });

  it('nothing is available while the partner has the place closed', async () => {
    const { svc } = setup({
      place: { id: 'p1', isActive: true, externalOpen: false },
    });
    expect((await svc.availableSeats(query)).placeOpen).toBe(false);
  });

  it('lists free seats of an open place', async () => {
    const { svc } = setup({});
    expect(await svc.availableSeats(query)).toMatchObject({
      total: 1,
      placeOpen: true,
    });
  });

  it('a seat with a booked range in the window is not available', async () => {
    const { svc } = setup({
      busy: [{ start, end: at('2026-11-09T04:00:00.000Z') }],
    });
    expect(
      await svc.seatAvailability(
        seat,
        start,
        end,
        at('2026-11-08T00:00:00.000Z'),
      ),
    ).toMatchObject({
      available: false,
      bookable: true,
      placeOpen: true,
    });
  });

  it('a seat in maintenance is not available', async () => {
    const { svc } = setup({});
    const a = await svc.seatAvailability(
      { ...seat, status: SeatStatus.MAINTENANCE },
      start,
      end,
    );
    expect(a).toMatchObject({ available: false, bookable: false });
  });

  it('occupied now only matters when the window includes now', async () => {
    const { svc } = setup({ occupiedNow: true });
    expect(
      (
        await svc.seatAvailability(
          seat,
          start,
          end,
          at('2026-11-09T03:30:00.000Z'),
        )
      ).available,
    ).toBe(false);
    expect(
      (
        await svc.seatAvailability(
          seat,
          start,
          end,
          at('2026-11-08T00:00:00.000Z'),
        )
      ).available,
    ).toBe(true);
  });
});
