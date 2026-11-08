import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  EntityManager,
  QueryFailedError,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';
import { Seat } from '../entities/seat.entity';
import { PlaceSeatQueryDto, SeatQueryDto } from '../dto/seat-query.dto';
import { SeatStatus } from '../../common/enums';
import { CreateSeatDto } from '../dto/create-seat.dto';
import { UpdateSeatDto } from '../dto/update-seat.dto';
import { SeatPageResponseDto, toSeatResponse } from '../dto/seat.response.dto';

// shortcut: reads places directly until PlacesService exists; switch to it when the places module lands.
const PLACE_VISIBLE =
  'EXISTS (SELECT 1 FROM places p WHERE p.id = seat.place_id AND p.deleted_at IS NULL AND p.is_active)';

const AREA_MISMATCH = 'areaId does not belong to this place';

function mapDbError(err: unknown): unknown {
  if (!(err instanceof QueryFailedError)) return err;
  const { code, constraint } = err.driverError as {
    code?: string;
    constraint?: string;
  };
  if (code === '23505' && constraint === 'seats_place_label_uk')
    return new ConflictException('Seat label already exists in this place');
  if (code === '23503' && constraint === 'seats_area_same_place_fk')
    return new BadRequestException(AREA_MISMATCH);
  return err;
}

@Injectable()
export class SeatsService {
  constructor(
    @InjectRepository(Seat) private readonly seats: Repository<Seat>,
  ) {}

  list(query: SeatQueryDto): Promise<SeatPageResponseDto> {
    return this.page(query, query.placeId);
  }

  async listByPlace(
    placeId: string,
    query: PlaceSeatQueryDto,
  ): Promise<SeatPageResponseDto> {
    const [visible] = await this.seats.manager.query(
      `SELECT 1 FROM places WHERE id = $1 AND deleted_at IS NULL AND is_active`,
      [placeId],
    );
    if (!visible) throw new NotFoundException('Place not found');
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
    const [place] = await this.seats.manager.query(
      `SELECT 1 FROM places WHERE id = $1 AND deleted_at IS NULL`,
      [placeId],
    );
    if (!place) throw new NotFoundException('Place not found');
    if (dto.areaId) await this.assertAreaInPlace(dto.areaId, placeId);
    return this.save(
      this.seats.create({
        placeId,
        label: dto.label,
        areaId: dto.areaId ?? null,
        features: dto.features ?? {},
      }),
    );
  }

  async update(seatId: string, dto: UpdateSeatDto): Promise<Seat> {
    const seat = await this.findAdmin(seatId);
    if (dto.areaId) await this.assertAreaInPlace(dto.areaId, seat.placeId);
    if (dto.label !== undefined) seat.label = dto.label;
    if (dto.areaId !== undefined) seat.areaId = dto.areaId;
    if (dto.features !== undefined) seat.features = dto.features;
    // The loaded relation would override areaId on save.
    delete (seat as Partial<Seat>).area;
    return this.save(seat);
  }

  async setStatus(seatId: string, status: SeatStatus): Promise<Seat> {
    // shortcut: no seat.status_changed outbox event (api-endpoints.md:162) until messaging lands; add OutboxService.add in the same transaction then.
    // shortcut: does not check future bookings (bookings imports seats); bookings dev adds the guard.
    const seat = await this.findAdmin(seatId);
    seat.status = status;
    return this.save(seat);
  }

  async softDelete(seatId: string): Promise<void> {
    // shortcut: does not check future bookings (bookings imports seats); bookings dev adds the guard.
    await this.findAdmin(seatId);
    await this.seats.softDelete(seatId);
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

  private async save(seat: Seat): Promise<Seat> {
    try {
      return await this.seats.save(seat);
    } catch (err) {
      throw mapDbError(err);
    }
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
