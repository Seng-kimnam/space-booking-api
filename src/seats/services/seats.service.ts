import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Repository, SelectQueryBuilder } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { isDeepStrictEqual } from 'node:util';
import { Seat } from '../entities/seat.entity';
import {
  PlaceSeatQueryDto,
  SeatQueryDto,
  type SeatSortField,
} from '../dto/seat-query.dto';
import { SortOrder } from '../../common/dto/pagination-query.dto';
import {
  applySort,
  escapeLike,
  pageOffset,
  type SortSpec,
  toPageResponse,
} from '../../common/utils/pagination';
import { SeatStatus } from '../../common/enums';
import { CreateSeatDto } from '../dto/create-seat.dto';
import { UpdateSeatDto } from '../dto/update-seat.dto';
import { SeatPageResponseDto, toSeatResponse } from '../dto/seat.response.dto';
import {
  assertNotPartnerManaged,
  PlacesService,
} from '../../places/services/places.service';
import { PG_UNIQUE_VIOLATION, isPgError } from '../../common/utils/db-errors';
import { PLACE_CHANGE_BOOKINGS } from '../../places/places.ports';
import type { PlaceChangeBookingsPort } from '../../places/places.ports';

// Seat queries filter on their place inside the same SQL (one round trip, and
// the filter composes with pagination), so this stays a subquery rather than a
// PlacesService call. Single-place checks go through PlacesService.
const PLACE_VISIBLE =
  'EXISTS (SELECT 1 FROM places p WHERE p.id = seat.place_id AND p.deleted_at IS NULL AND p.is_active)';
// Bookable also needs the partner (LMS) to have the place open; NULL = not partner-managed.
const PLACE_BOOKABLE =
  'EXISTS (SELECT 1 FROM places p WHERE p.id = seat.place_id AND p.deleted_at IS NULL AND p.is_active AND p.external_open IS NOT FALSE)';

const AREA_MISMATCH = 'areaId does not belong to this place';

// By label within each place (GET /seats spans places), as before.
const SEAT_SORT: SortSpec<SeatSortField> = {
  columns: {
    label: ['seat.placeId', 'seat.label'],
    createdAt: 'seat.createdAt',
  },
  default: { sortBy: 'label', order: SortOrder.ASC },
  tieBreaker: 'seat.id',
};

const PG_FOREIGN_KEY_VIOLATION = '23503'; // not in common/utils/db-errors.ts yet

function mapDbError(err: unknown): unknown {
  if (isPgError(err, PG_UNIQUE_VIOLATION, 'seats_place_label_uk'))
    return new ConflictException('Seat label already exists in this place');
  if (isPgError(err, PG_FOREIGN_KEY_VIOLATION, 'seats_area_same_place_fk'))
    return new BadRequestException(AREA_MISMATCH);
  return err;
}

@Injectable()
export class SeatsService {
  // Forwards to AppLogger (main.ts). Admin writes are logged as an audit trail;
  // reads are not. Unexpected errors are logged by Nest's exception handler.
  private readonly logger = new Logger(SeatsService.name);

  constructor(
    @InjectRepository(Seat) private readonly seats: Repository<Seat>,
    private readonly places: PlacesService,
    // Bound by bookings (BookingsBindingsModule); optional so seats-only tests compile.
    @Optional()
    @Inject(PLACE_CHANGE_BOOKINGS)
    private readonly bookingChanges?: PlaceChangeBookingsPort,
  ) {}

  list(query: SeatQueryDto): Promise<SeatPageResponseDto> {
    return this.page(query, query.placeId);
  }

  async listByPlace(
    placeId: string,
    query: PlaceSeatQueryDto,
  ): Promise<SeatPageResponseDto> {
    await this.places.getActivePlace(placeId); // 404 unless active, not deleted
    return this.page(query, placeId);
  }

  async findOne(seatId: string): Promise<Seat> {
    const seat = await this.visible()
      .andWhere('seat.id = :seatId', { seatId })
      .getOne();
    if (!seat) throw new NotFoundException('Seat not found');
    return seat;
  }

  /**
   * Bookable seats among `seatIds`: ACTIVE, not deleted, in an active place.
   * Unknown or unbookable ids are left out. Used by bookings (SEAT_LOOKUP port);
   * pass the caller's `manager` so the read joins its transaction.
   * With a manager the seat rows are locked FOR SHARE: an admin putting the
   * seat in maintenance or deleting it waits for the booking to commit, and
   * then cancels it (otherwise a booking racing the admin write would survive).
   */
  async findBookable(
    seatIds: string[],
    manager?: EntityManager,
  ): Promise<{ id: string; placeId: string; label: string }[]> {
    if (seatIds.length === 0) return [];
    const qb = (manager ?? this.seats.manager)
      .getRepository(Seat)
      .createQueryBuilder('seat')
      .select(['seat.id', 'seat.placeId', 'seat.label'])
      .where(PLACE_BOOKABLE)
      .andWhere('seat.id IN (:...seatIds)', { seatIds })
      .andWhere('seat.status = :status', { status: SeatStatus.ACTIVE });
    // Locks need a transaction; without a manager this is a plain read.
    if (manager) qb.setLock('pessimistic_read', undefined, ['seat']);
    const rows = await qb.getMany();
    return rows.map((s) => ({ id: s.id, placeId: s.placeId, label: s.label }));
  }

  async create(placeId: string, dto: CreateSeatDto): Promise<Seat> {
    // Admins may add seats to inactive places, not to deleted ones (404).
    assertNotPartnerManaged(await this.places.getPlace(placeId));
    if (dto.areaId) await this.assertAreaInPlace(dto.areaId, placeId);
    const seat = await this.save(
      this.seats.create({
        placeId,
        label: dto.label,
        areaId: dto.areaId ?? null,
        features: dto.features ?? {},
      }),
    );
    this.logger.log(
      `Seat created: id=${seat.id} place=${placeId} label=${seat.label}`,
    );
    return seat;
  }

  async update(seatId: string, dto: UpdateSeatDto): Promise<Seat> {
    const seat = await this.findAdmin(seatId);
    assertNotPartnerManaged(await this.places.getPlace(seat.placeId));
    if (dto.areaId) await this.assertAreaInPlace(dto.areaId, seat.placeId);
    // Only values that differ are written: an unchanged value must not bump updated_at.
    const patch: QueryDeepPartialEntity<Seat> = {};
    if (dto.label !== undefined && dto.label !== seat.label)
      patch.label = dto.label;
    if (dto.areaId !== undefined && dto.areaId !== seat.areaId)
      patch.areaId = dto.areaId;
    if (
      dto.features !== undefined &&
      !isDeepStrictEqual(dto.features, seat.features)
    )
      patch.features = dto.features;
    const changed = Object.keys(patch);
    if (changed.length === 0) {
      this.logger.log(`Seat updated: id=${seatId} fields=none`);
      return seat;
    }
    await this.write(seatId, patch);
    this.logger.log(`Seat updated: id=${seatId} fields=${changed.join(',')}`);
    return this.findAdmin(seatId);
  }

  async setStatus(seatId: string, status: SeatStatus): Promise<Seat> {
    // shortcut: no seat.status_changed outbox event (api-endpoints.md:162) until messaging lands; add OutboxService.add in the same transaction then.
    const seat = await this.findAdmin(seatId);
    assertNotPartnerManaged(await this.places.getPlace(seat.placeId));
    // Same status: nothing to change, don't bump updated_at.
    if (seat.status === status) return seat;
    // MAINTENANCE/UNAVAILABLE: PENDING bookings on the seat are cancelled in
    // the same transaction (they would expire as no-shows otherwise).
    // CHECKED_IN ones stay: the user is in the seat; staff resolve those.
    const cancelled = await this.seats.manager.transaction(async (m) => {
      await this.write(seatId, { status }, m);
      if (status === SeatStatus.ACTIVE || !this.bookingChanges) return 0;
      return this.bookingChanges.cancelAffected(
        m,
        seat.placeId,
        { seatId },
        'SEAT_UNAVAILABLE',
      );
    });
    this.logger.log(
      `Seat status changed: id=${seatId} ${seat.status} -> ${status} cancelledBookings=${cancelled}`,
    );
    return this.findAdmin(seatId);
  }

  /**
   * Soft delete. 409 while someone is in the seat (CHECKED_IN or
   * CHECKOUT_OVERDUE booking); its PENDING bookings are cancelled in the same
   * transaction.
   */
  async softDelete(seatId: string): Promise<void> {
    const seat = await this.findAdmin(seatId);
    assertNotPartnerManaged(await this.places.getPlace(seat.placeId));
    // Without the bookings port (seats-only tests) PENDING bookings block the delete too.
    const blocking = this.bookingChanges
      ? ['CHECKED_IN', 'CHECKOUT_OVERDUE']
      : ['PENDING', 'CHECKED_IN', 'CHECKOUT_OVERDUE'];
    const cancelled = await this.seats.manager.transaction(async (m) => {
      // Row lock first: a booking being created on this seat holds FOR SHARE
      // (findBookable), so this waits for it and the cancel below sees it.
      await m.query('SELECT 1 FROM seats WHERE id = $1 FOR UPDATE', [seatId]);
      // shortcut: reads bookings directly; seats can't import bookings (bookings -> seats).
      const [live] = await m.query(
        'SELECT 1 FROM bookings WHERE seat_id = $1 AND status = ANY($2::booking_status[]) LIMIT 1',
        [seatId, blocking],
      );
      if (live) {
        this.logger.warn(`Seat delete rejected: active bookings (id=${seatId})`);
        throw new ConflictException(
          'Seat still has active bookings; cancel or complete them first',
        );
      }
      await m.softDelete(Seat, { id: seatId });
      return this.bookingChanges
        ? this.bookingChanges.cancelAffected(m, seat.placeId, { seatId }, 'SEAT_DELETED')
        : 0;
    });
    this.logger.log(
      `Seat deleted: id=${seatId} place=${seat.placeId} label=${seat.label} cancelledBookings=${cancelled}`,
    );
  }

  // Admins also see seats of inactive places, unlike public reads.
  private async findAdmin(seatId: string): Promise<Seat> {
    const seat = await this.seats
      .createQueryBuilder('seat')
      .where(
        'EXISTS (SELECT 1 FROM places p WHERE p.id = seat.place_id AND p.deleted_at IS NULL)',
      )
      .andWhere('seat.id = :seatId', { seatId })
      .getOne();
    if (!seat) throw new NotFoundException('Seat not found');
    return seat;
  }

  private async assertAreaInPlace(areaId: string, placeId: string) {
    const [area] = await this.seats.manager.query(
      `SELECT 1 FROM areas WHERE id = $1 AND place_id = $2 AND deleted_at IS NULL`,
      [areaId, placeId],
    );
    if (!area) throw new BadRequestException(AREA_MISMATCH);
  }

  // Targeted UPDATE of only the given columns, never save(entity): save re-reads the
  // row and writes back every column of a stale copy, undoing concurrent changes.
  // The deleted_at filter keeps a write from touching (or reviving) a deleted seat.
  private async write(
    seatId: string,
    patch: QueryDeepPartialEntity<Seat>,
    manager?: EntityManager,
  ): Promise<void> {
    const repo = manager ? manager.getRepository(Seat) : this.seats;
    try {
      const { affected } = await repo.update(
        { id: seatId, deletedAt: IsNull() },
        patch,
      );
      if (!affected) throw new NotFoundException('Seat not found');
    } catch (err) {
      this.rethrowMappedDbError(err);
    }
  }

  private async save(seat: Seat): Promise<Seat> {
    try {
      return await this.seats.save(seat);
    } catch (err) {
      this.rethrowMappedDbError(err);
    }
  }

  private rethrowMappedDbError(err: unknown): never {
    const mapped = mapDbError(err);
    // Expected client errors (duplicate label, wrong area): warn, not error.
    if (mapped !== err && mapped instanceof Error)
      this.logger.warn(`Seat write rejected: ${mapped.message}`);
    throw mapped;
  }

  private visible(): SelectQueryBuilder<Seat> {
    return this.seats.createQueryBuilder('seat').where(PLACE_VISIBLE);
  }

  private async page(
    query: PlaceSeatQueryDto,
    placeId?: string,
  ): Promise<SeatPageResponseDto> {
    const qb = this.visible();
    if (placeId) qb.andWhere('seat.placeId = :placeId', { placeId });
    if (query.areaId)
      qb.andWhere('seat.areaId = :areaId', { areaId: query.areaId });
    if (query.status)
      qb.andWhere('seat.status = :status', { status: query.status });
    if (query.search)
      qb.andWhere('seat.label ILIKE :search', {
        search: `%${escapeLike(query.search)}%`,
      });
    const [rows, total] = await applySort(qb, query, SEAT_SORT)
      .skip(pageOffset(query))
      .take(query.limit)
      .getManyAndCount();
    return toPageResponse(query, rows, total, toSeatResponse);
  }
}
