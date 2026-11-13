import {
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { IsNull, QueryFailedError, Repository } from 'typeorm';
import { Seat } from '../entities/seat.entity';
import { SeatStatus } from '../../common/enums';
import { toSeatResponse } from '../dto/seat.response.dto';
import { PlacesService } from '../../places/services/places.service';
import { SeatsService } from './seats.service';

const dbError = (code: string, constraint: string) =>
  Object.assign(new QueryFailedError('q', [], new Error('x')), {
    driverError: { code, constraint },
  });
const repoFailing = (err: unknown) =>
  ({
    create: (v: object) => v,
    save: async () => Promise.reject(err),
    manager: { query: async () => [{}] },
  }) as unknown as Repository<Seat>;

// PlacesService stand-in: the place exists (or not, with the real 404).
const places = (found = true) =>
  ({
    getPlace: async () => {
      if (!found) throw new NotFoundException('Place not found');
      return {};
    },
    getActivePlace: async () => {
      if (!found) throw new NotFoundException('Place not found');
      return {};
    },
  }) as unknown as PlacesService;

const seatRow = (over: Partial<Seat> = {}): Seat =>
  ({
    id: 's1',
    placeId: 'p',
    areaId: null,
    label: 'A1',
    features: {},
    status: SeatStatus.ACTIVE,
    ...over,
  }) as Seat;

// Repository whose admin lookup finds `seat`, and whose save echoes it back.
const repoWithSeat = (seat: Seat | null) => {
  const qb = {
    where: () => qb,
    andWhere: () => qb,
    getOne: async () => seat,
  };
  const repo = {
    createQueryBuilder: () => qb,
    create: (v: object) => ({ id: 's1', ...v }),
    save: jest.fn(async (v: Seat) => v),
    update: jest.fn(async () => ({ affected: 1 })),
    softDelete: jest.fn(async (_criteria?: unknown) => undefined),
    manager: {
      query: async (..._args: unknown[]): Promise<unknown[]> => [{}],
      // The transaction's manager writes through the same fakes.
      transaction: async (fn: (m: unknown) => Promise<unknown>) =>
        fn({
          getRepository: () => repo,
          query: (...args: unknown[]) => repo.manager.query(...args),
          softDelete: (_target: unknown, criteria: unknown) =>
            repo.softDelete(criteria),
        }),
    },
  };
  return repo;
};

// PLACE_CHANGE_BOOKINGS stand-in: reports how many bookings it cancelled.
const bookingChanges = (cancelled = 2) => ({
  cancelAffected: jest.fn(async () => cancelled),
});

describe('SeatsService', () => {
  let log: jest.SpyInstance;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('create maps unique-label violation to 409 and warns', async () => {
    await expect(
      new SeatsService(
        repoFailing(dbError('23505', 'seats_place_label_uk')),
        places(),
      ).create('p', { label: 'A' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(warn).toHaveBeenCalledWith(
      'Seat write rejected: Seat label already exists in this place',
    );
  });

  it('create maps composite FK violation to 400', async () => {
    await expect(
      new SeatsService(
        repoFailing(dbError('23503', 'seats_area_same_place_fk')),
        places(),
      ).create('p', { label: 'A' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('create rethrows unknown DB errors without a warn', async () => {
    const err = dbError('99999', 'other');
    await expect(
      new SeatsService(repoFailing(err), places()).create('p', { label: 'A' }),
    ).rejects.toBe(err);
    expect(warn).not.toHaveBeenCalled();
  });

  it('create throws 404 when the place is missing and 400 when the area is foreign', async () => {
    await expect(
      new SeatsService({} as Repository<Seat>, places(false)).create('p', {
        label: 'A',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    const r = {
      manager: { query: async () => [] }, // area lookup finds nothing
    } as unknown as Repository<Seat>;
    await expect(
      new SeatsService(r, places()).create('p', { label: 'A', areaId: 'a' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('listByPlace throws 404 when the place is not visible', async () => {
    await expect(
      new SeatsService({} as Repository<Seat>, places(false)).listByPlace('p', {
        page: 1,
        limit: 20,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('update, setStatus and softDelete throw 404 for an unknown seat', async () => {
    const svc = new SeatsService(
      repoWithSeat(null) as unknown as Repository<Seat>,
      places(),
    );
    await expect(svc.update('x', {})).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.setStatus('x', 'ACTIVE' as never)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(svc.softDelete('x')).rejects.toBeInstanceOf(NotFoundException);
    expect(log).not.toHaveBeenCalled();
  });

  it('findOne throws 404 when the seat is not visible', async () => {
    const repo = repoWithSeat(null) as unknown as Repository<Seat>;
    await expect(
      new SeatsService(repo, places()).findOne('x'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  describe('audit logging', () => {
    it('logs create with id, place and label', async () => {
      const repo = repoWithSeat(null);
      await new SeatsService(
        repo as unknown as Repository<Seat>,
        places(),
      ).create('p', { label: 'A1' });
      expect(log).toHaveBeenCalledWith('Seat created: id=s1 place=p label=A1');
    });

    it('logs which fields an update changed', async () => {
      const repo = repoWithSeat(seatRow());
      await new SeatsService(
        repo as unknown as Repository<Seat>,
        places(),
      ).update('s1', { label: 'B2' });
      expect(log).toHaveBeenCalledWith('Seat updated: id=s1 fields=label');
    });

    it('logs a status change with old and new status', async () => {
      const repo = repoWithSeat(seatRow());
      await new SeatsService(
        repo as unknown as Repository<Seat>,
        places(),
      ).setStatus('s1', SeatStatus.MAINTENANCE);
      expect(log).toHaveBeenCalledWith(
        'Seat status changed: id=s1 ACTIVE -> MAINTENANCE cancelledBookings=0',
      );
    });

    it('setting the same status is a no-op: no save, no log', async () => {
      const repo = repoWithSeat(seatRow());
      const result = await new SeatsService(
        repo as unknown as Repository<Seat>,
        places(),
      ).setStatus('s1', SeatStatus.ACTIVE);
      expect(result.status).toBe(SeatStatus.ACTIVE);
      expect(repo.save).not.toHaveBeenCalled();
      expect(repo.update).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
    });

    it('update writes only the changed columns', async () => {
      const repo = repoWithSeat(seatRow());
      await new SeatsService(
        repo as unknown as Repository<Seat>,
        places(),
      ).update('s1', { label: 'B2' });
      expect(repo.update).toHaveBeenCalledWith(
        { id: 's1', deletedAt: IsNull() },
        { label: 'B2' },
      );
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('update passes areaId null through and leaves other columns out', async () => {
      const repo = repoWithSeat(seatRow({ areaId: 'area-1' }));
      await new SeatsService(
        repo as unknown as Repository<Seat>,
        places(),
      ).update('s1', { areaId: null });
      expect(repo.update).toHaveBeenCalledWith(
        { id: 's1', deletedAt: IsNull() },
        { areaId: null },
      );
    });

    it('update skips columns whose value is unchanged', async () => {
      const repo = repoWithSeat(
        seatRow({ label: 'A1', areaId: null, features: { power: true } }),
      );
      await new SeatsService(
        repo as unknown as Repository<Seat>,
        places(),
      ).update('s1', { label: 'A1', areaId: null, features: { power: true } });
      expect(repo.update).not.toHaveBeenCalled();
      expect(repo.save).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith('Seat updated: id=s1 fields=none');
    });

    it('update writes only the columns that differ', async () => {
      const repo = repoWithSeat(
        seatRow({ label: 'A1', areaId: null, features: { power: true } }),
      );
      await new SeatsService(
        repo as unknown as Repository<Seat>,
        places(),
      ).update('s1', { label: 'A1', features: { power: false } });
      expect(repo.update).toHaveBeenCalledWith(
        { id: 's1', deletedAt: IsNull() },
        { features: { power: false } },
      );
      expect(log).toHaveBeenCalledWith('Seat updated: id=s1 fields=features');
    });

    it('update with an empty body issues no write', async () => {
      const repo = repoWithSeat(seatRow());
      const result = await new SeatsService(
        repo as unknown as Repository<Seat>,
        places(),
      ).update('s1', {});
      expect(repo.update).not.toHaveBeenCalled();
      expect(repo.save).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith('Seat updated: id=s1 fields=none');
      expect(result.id).toBe('s1');
    });

    it('setStatus writes only the status column', async () => {
      const repo = repoWithSeat(seatRow());
      await new SeatsService(
        repo as unknown as Repository<Seat>,
        places(),
      ).setStatus('s1', SeatStatus.MAINTENANCE);
      expect(repo.update).toHaveBeenCalledWith(
        { id: 's1', deletedAt: IsNull() },
        { status: SeatStatus.MAINTENANCE },
      );
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('update and setStatus throw 404 when the write matches no live row', async () => {
      const repo = repoWithSeat(seatRow());
      repo.update.mockResolvedValue({ affected: 0 });
      const svc = new SeatsService(
        repo as unknown as Repository<Seat>,
        places(),
      );
      await expect(svc.update('s1', { label: 'B2' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(
        svc.setStatus('s1', SeatStatus.MAINTENANCE),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(warn).not.toHaveBeenCalled();
    });

    it('update maps a unique-label violation from the write to 409 and warns', async () => {
      const repo = repoWithSeat(seatRow());
      repo.update.mockRejectedValue(dbError('23505', 'seats_place_label_uk'));
      await expect(
        new SeatsService(repo as unknown as Repository<Seat>, places()).update(
          's1',
          { label: 'B2' },
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('logs a soft delete', async () => {
      const repo = repoWithSeat(seatRow());
      repo.manager.query = async () => []; // no live bookings
      await new SeatsService(
        repo as unknown as Repository<Seat>,
        places(),
      ).softDelete('s1');
      expect(repo.softDelete).toHaveBeenCalledWith({ id: 's1' });
      expect(log).toHaveBeenCalledWith(
        'Seat deleted: id=s1 place=p label=A1 cancelledBookings=0',
      );
    });

    it('softDelete throws 409 and does not delete while the seat has a live booking', async () => {
      const repo = repoWithSeat(seatRow()); // default query returns [{}]: a live booking
      await expect(
        new SeatsService(repo as unknown as Repository<Seat>, places()).softDelete(
          's1',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(repo.softDelete).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(1);
    });
  });

  describe('cancelling bookings an admin change makes impossible', () => {
    it('MAINTENANCE cancels the seat\'s PENDING bookings in the same transaction', async () => {
      const repo = repoWithSeat(seatRow());
      const port = bookingChanges();
      await new SeatsService(
        repo as unknown as Repository<Seat>,
        places(),
        port,
      ).setStatus('s1', SeatStatus.MAINTENANCE);
      expect(port.cancelAffected).toHaveBeenCalledWith(
        expect.anything(),
        'p',
        { seatId: 's1' },
        'SEAT_UNAVAILABLE',
      );
      expect(log).toHaveBeenCalledWith(
        'Seat status changed: id=s1 ACTIVE -> MAINTENANCE cancelledBookings=2',
      );
    });

    it('back to ACTIVE cancels nothing', async () => {
      const repo = repoWithSeat(seatRow({ status: SeatStatus.MAINTENANCE }));
      const port = bookingChanges();
      await new SeatsService(
        repo as unknown as Repository<Seat>,
        places(),
        port,
      ).setStatus('s1', SeatStatus.ACTIVE);
      expect(port.cancelAffected).not.toHaveBeenCalled();
    });

    it('delete cancels PENDING bookings and only checked-in ones block it', async () => {
      const repo = repoWithSeat(seatRow());
      const queries: unknown[][] = [];
      repo.manager.query = async (...args: unknown[]) => {
        queries.push(args);
        return [];
      };
      const port = bookingChanges(1);
      await new SeatsService(
        repo as unknown as Repository<Seat>,
        places(),
        port,
      ).softDelete('s1');
      const liveCheck = queries.find(([sql]) => String(sql).includes('FROM bookings'));
      expect(liveCheck?.[1]).toEqual(['s1', ['CHECKED_IN', 'CHECKOUT_OVERDUE']]);
      expect(port.cancelAffected).toHaveBeenCalledWith(
        expect.anything(),
        'p',
        { seatId: 's1' },
        'SEAT_DELETED',
      );
      expect(repo.softDelete).toHaveBeenCalledWith({ id: 's1' });
    });

    it('delete is still refused while someone is checked in', async () => {
      const repo = repoWithSeat(seatRow()); // every query returns a row
      const port = bookingChanges();
      await expect(
        new SeatsService(
          repo as unknown as Repository<Seat>,
          places(),
          port,
        ).softDelete('s1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(port.cancelAffected).not.toHaveBeenCalled();
    });
  });

  it('toSeatResponse exposes exactly the 8 DTO keys', () => {
    const now = new Date();
    const dto = toSeatResponse({
      id: 'i',
      placeId: 'p',
      areaId: null,
      label: 'A1',
      features: {},
      status: SeatStatus.ACTIVE,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    } as Seat);
    expect(Object.keys(dto).sort()).toEqual([
      'areaId',
      'createdAt',
      'features',
      'id',
      'label',
      'placeId',
      'status',
      'updatedAt',
    ]);
  });
});
