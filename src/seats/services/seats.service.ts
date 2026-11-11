import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Repository, SelectQueryBuilder } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { isDeepStrictEqual } from 'node:util';
import { Seat } from '../entities/seat.entity';
import { PlaceSeatQueryDto, SeatQueryDto } from '../dto/seat-query.dto';
import { SeatStatus } from '../../common/enums';
import { CreateSeatDto } from '../dto/create-seat.dto';
import { UpdateSeatDto } from '../dto/update-seat.dto';
import { SeatPageResponseDto, toSeatResponse } from '../dto/seat.response.dto';
import { PlacesService } from '../../places/services/places.service';
import { PG_UNIQUE_VIOLATION, isPgError } from '../../common/utils/db-errors';

// Seat queries filter on their place inside the same SQL (one round trip, and
// the filter composes with pagination), so this stays a subquery rather than a
// PlacesService call. Single-place checks go through PlacesService.
const PLACE_VISIBLE =
  'EXISTS (SELECT 1 FROM places p WHERE p.id = seat.place_id AND p.deleted_at IS NULL AND p.is_active)';

const AREA_MISMATCH = 'areaId does not belong to this place';

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
   */
  async findBookable(
    seatIds: string[],
    manager?: EntityManager,
  ): Promise<{ id: string; placeId: string; label: string }[]> {
    if (seatIds.length === 0) return [];
    const rows = await (manager ?? this.seats.manager)
      .getRepository(Seat)
      .createQueryBuilder('seat')
      .select(['seat.id', 'seat.placeId', 'seat.label'])
      .where(PLACE_VISIBLE)
      .andWhere('seat.id IN (:...seatIds)', { seatIds })
      .andWhere('seat.status = :status', { status: SeatStatus.ACTIVE })
      .getMany();
    return rows.map((s) => ({ id: s.id, placeId: s.placeId, label: s.label }));
  }

  async create(placeId: string, dto: CreateSeatDto): Promise<Seat> {
    // Admins may add seats to inactive places, not to deleted ones (404).
    await this.places.getPlace(placeId);
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
    // shortcut: does not check future bookings (bookings imports seats); bookings dev adds the guard.
    const seat = await this.findAdmin(seatId);
    // Same status: nothing to change, don't bump updated_at.
    if (seat.status === status) return seat;
    await this.write(seatId, { status });
    this.logger.log(
      `Seat status changed: id=${seatId} ${seat.status} -> ${status}`,
    );
    return this.findAdmin(seatId);
  }

  async softDelete(seatId: string): Promise<void> {
    // shortcut: does not check future bookings (bookings imports seats); bookings dev adds the guard.
    const seat = await this.findAdmin(seatId);
    await this.seats.softDelete(seatId);
    this.logger.log(
      `Seat deleted: id=${seatId} place=${seat.placeId} label=${seat.label}`,
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
  ): Promise<void> {
    try {
      const { affected } = await this.seats.update(
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
    const [rows, total] = await qb
      .orderBy('seat.placeId')
      .addOrderBy('seat.label')
      .addOrderBy('seat.id')
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();
    return {
      items: rows.map(toSeatResponse),
      page: query.page,
      limit: query.limit,
      total,
    };
  }
}
