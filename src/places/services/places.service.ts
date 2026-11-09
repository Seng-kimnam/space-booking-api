import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import type { TimeRange } from '../../database/transformers/tstzrange.transformer';
import { isPgError } from '../../common/utils/db-errors';
import { CreatePlaceDto } from '../dto/create-place.dto';
import { PlaceQueryDto } from '../dto/place-query.dto';
import {
  PlaceDetailResponseDto,
  PlacePageResponseDto,
  toPlaceDetailResponse,
  toPlaceResponse,
} from '../dto/place.response.dto';
import { UpdatePlaceDto } from '../dto/update-place.dto';
import { BookingPolicy } from '../entities/booking-policy.entity';
import { Place } from '../entities/place.entity';
import { BookingPoliciesService } from './booking-policies.service';
import { OpeningHoursService } from './opening-hours.service';

const PG_CHECK_VIOLATION = '23514';
const PLACE_NOT_FOUND = 'Place not found';

/** Escapes LIKE wildcards so `q` is matched literally. */
const likeLiteral = (s: string) => `%${s.replace(/[\\%_]/g, '\\$&')}%`;

/**
 * Places plus their hours, closures and policy. Also the bookings module's
 * PLACE_RULES port (getBookingContext, isOpenForRange), bound in
 * bookings.module.ts with useExisting.
 */
@Injectable()
export class PlacesService {
  constructor(
    @InjectRepository(Place) private readonly places: Repository<Place>,
    @InjectDataSource() private readonly ds: DataSource,
    private readonly hours: OpeningHoursService,
    private readonly policies: BookingPoliciesService,
  ) {}

  // ---- public reads: active, not deleted ----

  async list(query: PlaceQueryDto): Promise<PlacePageResponseDto> {
    const qb = this.places
      .createQueryBuilder('place')
      .where('place.isActive = true');
    if (query.q)
      qb.andWhere('(place.name ILIKE :q OR place.address ILIKE :q)', {
        q: likeLiteral(query.q),
      });
    if (query.type) qb.andWhere('place.type = :type', { type: query.type });
    const [rows, total] = await qb
      .orderBy('place.name')
      .addOrderBy('place.id')
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();
    return {
      items: rows.map(toPlaceResponse),
      page: query.page,
      limit: query.limit,
      total,
    };
  }

  async findPublicDetail(placeId: string): Promise<PlaceDetailResponseDto> {
    return this.detail(await this.findVisible(placeId));
  }

  /** Throws 404 unless the place exists, is active and not deleted. */
  async findVisible(placeId: string, manager?: EntityManager): Promise<Place> {
    const place = await (manager ?? this.ds.manager)
      .getRepository(Place)
      .findOneBy({ id: placeId, isActive: true });
    if (!place) throw new NotFoundException(PLACE_NOT_FOUND);
    return place;
  }

  /** Admin view: inactive places count, deleted ones don't. Throws 404. */
  async findForAdmin(placeId: string, manager?: EntityManager): Promise<Place> {
    const place = await (manager ?? this.ds.manager)
      .getRepository(Place)
      .findOneBy({ id: placeId });
    if (!place) throw new NotFoundException(PLACE_NOT_FOUND);
    return place;
  }

  // ---- admin writes ----

  /** Place + policy (+ hours, closures) in one transaction. */
  async create(dto: CreatePlaceDto): Promise<PlaceDetailResponseDto> {
    const id = await this.write(async (m) => {
      const place = await m.getRepository(Place).save(
        m.getRepository(Place).create({
          name: dto.name,
          type: dto.type,
          description: dto.description ?? null,
          address: dto.address,
          lat: dto.lat ?? null,
          lng: dto.lng ?? null,
          // `??` so an explicit null falls back to the column default, not a NOT NULL error.
          timezone: dto.timezone ?? undefined,
          isActive: dto.isActive ?? undefined,
        }),
      );
      await this.policies.create(m, place.id, dto.policy);
      if (dto.openingHours)
        await this.hours.replaceHours(m, place.id, dto.openingHours);
      if (dto.closures)
        await this.hours.replaceClosures(m, place.id, dto.closures);
      return place.id;
    });
    return this.detail(await this.findForAdmin(id));
  }

  async update(
    placeId: string,
    dto: UpdatePlaceDto,
  ): Promise<PlaceDetailResponseDto> {
    await this.write(async (m) => {
      const repo = m.getRepository(Place);
      // Row lock: concurrent PATCHes of one place replace hours/closures one at a time.
      const place = await repo.findOne({
        where: { id: placeId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!place) throw new NotFoundException(PLACE_NOT_FOUND);

      const fields = [
        'name',
        'type',
        'description',
        'address',
        'lat',
        'lng',
        'timezone',
        'isActive',
      ] as const;
      let changed = false;
      for (const f of fields) {
        if (dto[f] !== undefined) {
          (place as unknown as Record<string, unknown>)[f] = dto[f];
          changed = true;
        }
      }
      if (changed) await repo.save(place);
      if (dto.openingHours)
        await this.hours.replaceHours(m, placeId, dto.openingHours);
      if (dto.closures)
        await this.hours.replaceClosures(m, placeId, dto.closures);
      if (dto.policy) await this.policies.update(m, placeId, dto.policy);
    });
    return this.detail(await this.findForAdmin(placeId));
  }

  /**
   * Soft delete: the place, its areas and seats vanish from every read (they
   * all filter on the place), and history rows keep their FKs.
   */
  async softDelete(placeId: string): Promise<void> {
    // shortcut: doesn't reject places with upcoming bookings; places can't import
    // bookings (graph in docs/project-structure.md). Bookings dev adds that guard.
    await this.findForAdmin(placeId);
    await this.places.softDelete(placeId);
  }

  // ---- PLACE_RULES port for bookings ----

  /** Throws 404 if the place doesn't exist, is inactive, or has no policy. */
  async getBookingContext(
    placeId: string,
    manager?: EntityManager,
  ): Promise<{
    placeId: string;
    name: string;
    timezone: string;
    policy: BookingPolicy;
  }> {
    const place = await this.findVisible(placeId, manager);
    const policy = await this.policies.findByPlace(placeId, manager);
    if (!policy) throw new NotFoundException(PLACE_NOT_FOUND);
    return { placeId, name: place.name, timezone: place.timezone, policy };
  }

  isOpenForRange(
    placeId: string,
    range: TimeRange,
    manager?: EntityManager,
  ): Promise<boolean> {
    return this.hours.isOpenForRange(placeId, range, manager);
  }

  // ---- helpers ----

  private async detail(place: Place): Promise<PlaceDetailResponseDto> {
    const [hours, closures, policy] = await Promise.all([
      this.hours.findHours(place.id),
      this.hours.findUpcomingClosures(place.id),
      this.policies.findByPlace(place.id),
    ]);
    return toPlaceDetailResponse(place, hours, closures, policy);
  }

  /** Runs `fn` in a transaction; a CHECK the DTOs missed becomes 400, not 500. */
  private async write<T>(fn: (m: EntityManager) => Promise<T>): Promise<T> {
    try {
      return await this.ds.transaction(fn);
    } catch (err) {
      if (isPgError(err, PG_CHECK_VIOLATION))
        throw new BadRequestException(
          'Values violate a place, hours or policy rule',
        );
      throw err;
    }
  }
}
