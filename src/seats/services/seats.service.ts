import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { Seat } from '../entities/seat.entity';
import { PlaceSeatQueryDto, SeatQueryDto } from '../dto/seat-query.dto';
import { SeatPageResponseDto, toSeatResponse } from '../dto/seat.response.dto';

// shortcut: reads places directly until PlacesService exists; switch to it when the places module lands.
const PLACE_VISIBLE =
  'EXISTS (SELECT 1 FROM places p WHERE p.id = seat.place_id AND p.deleted_at IS NULL AND p.is_active)';

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
