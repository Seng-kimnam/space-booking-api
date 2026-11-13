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
import { EntityManager, QueryFailedError, Repository } from 'typeorm';
import { BookingPolicy } from '../entities/booking-policy.entity';
import { PlaceClosure } from '../entities/place-closure.entity';
import { PlaceOpeningHour } from '../entities/place-opening-hour.entity';
import { Place } from '../entities/place.entity';
import { MessageType } from '../../messaging/contract/schemas';
import { OutboxService } from '../../messaging/outbox/outbox.service';
import { PLACE_CHANGE_BOOKINGS } from '../places.ports';
import type { PlaceChangeBookingsPort } from '../places.ports';
import { BookingPolicyDto } from '../dto/booking-policy.dto';
import { ClosureDto } from '../dto/closure.dto';
import { CreatePlaceDto } from '../dto/create-place.dto';
import { OpeningHourDto } from '../dto/opening-hour.dto';
import { PlaceQueryDto } from '../dto/place-query.dto';
import { UpdatePlaceDto } from '../dto/update-place.dto';
import {
  PlaceDetailResponseDto,
  PlacePageResponseDto,
  toPlaceDetailResponse,
  toPlaceResponse,
} from '../dto/place.response.dto';

export function mapDbError(err: unknown): unknown {
  if (!(err instanceof QueryFailedError)) return err;
  const { code, constraint } = err.driverError as {
    code?: string;
    constraint?: string;
  };
  if (code === '23514' && constraint === 'booking_policies_max_chk')
    return new BadRequestException(
      'bookingPolicy.maxMinutes must be greater than or equal to minMinutes',
    );
  if (code === '23514' && constraint?.startsWith('booking_policies_'))
    return new BadRequestException(`bookingPolicy violates ${constraint}`);
  // Writes lock the place row, so these only fire on a race we did not foresee.
  if (
    code === '23505' &&
    (constraint === 'place_opening_hours_place_weekday_uk' ||
      constraint === 'place_closures_place_date_uk')
  )
    return new ConflictException('Place was changed concurrently, retry');
  return err;
}

/**
 * Fields the partner owns on a partner-managed place (docs/lms-integration-proposal.md
 * section 3.1). Our admins keep isActive (go-live) and bookingPolicy.
 */
const PARTNER_OWNED_FIELDS = [
  'name',
  'type',
  'description',
  'address',
  'lat',
  'lng',
  'timezone',
  'openingHours',
  'closures',
] as const;

/**
 * 409 for admin writes to a partner-managed place, its areas or its seats: the
 * partner's next snapshot would overwrite them. Change them in the partner system.
 */
export function assertNotPartnerManaged(
  place: Pick<Place, 'externalSystem'>,
): void {
  if (place.externalSystem)
    throw new ConflictException(
      `Managed by the ${place.externalSystem} system; change it there`,
    );
}

// For ILIKE: treat the user's %, _ and \ literally.
export const escapeLike = (s: string): string => s.replace(/[\\%_]/g, '\\$&');

// DTO instances carry own `undefined` properties (useDefineForClassFields), and
// Object.assign would copy them over real values.
export function definedOnly<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

@Injectable()
export class PlacesService {
  // Forwards to AppLogger (main.ts). Admin writes are logged after commit as an
  // audit trail; reads are not.
  private readonly logger = new Logger(PlacesService.name);

  constructor(
    @InjectRepository(Place) private readonly places: Repository<Place>,
    @InjectRepository(PlaceOpeningHour)
    private readonly hours: Repository<PlaceOpeningHour>,
    @InjectRepository(PlaceClosure)
    private readonly closures: Repository<PlaceClosure>,
    @InjectRepository(BookingPolicy)
    private readonly policies: Repository<BookingPolicy>,
    // From the global MessagingModule. Optional so module-level tests that
    // don't load messaging still compile the places module.
    @Optional() private readonly outbox?: OutboxService,
    // Bound by bookings (BookingsBindingsModule). Optional for the same reason.
    @Optional()
    @Inject(PLACE_CHANGE_BOOKINGS)
    private readonly bookingChanges?: PlaceChangeBookingsPort,
  ) {}

  /** Public list: active, not deleted. */
  async list(query: PlaceQueryDto): Promise<PlacePageResponseDto> {
    const qb = this.places
      .createQueryBuilder('place')
      .where('place.isActive = true');
    if (query.type) qb.andWhere('place.type = :type', { type: query.type });
    if (query.search)
      qb.andWhere('place.name ILIKE :search', {
        search: `%${escapeLike(query.search)}%`,
      });
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

  /** Public detail: 404 for inactive or deleted places. */
  findVisible(placeId: string): Promise<PlaceDetailResponseDto> {
    return this.detail(placeId, false);
  }

  /** Active, non-deleted place, for other modules (e.g. bookings). */
  async getActivePlace(placeId: string): Promise<Place> {
    const place = await this.places.findOneBy({ id: placeId, isActive: true });
    if (!place) throw new NotFoundException('Place not found');
    return place;
  }

  /** Non-deleted place, active or not, for admin writes in other modules (e.g. areas). */
  async getPlace(placeId: string): Promise<Place> {
    const place = await this.places.findOneBy({ id: placeId });
    if (!place) throw new NotFoundException('Place not found');
    return place;
  }

  async create(dto: CreatePlaceDto): Promise<PlaceDetailResponseDto> {
    const placeId = await this.transaction(async (m) => {
      const place = await m.save(
        m.create(Place, {
          name: dto.name,
          type: dto.type,
          description: dto.description ?? null,
          address: dto.address,
          lat: dto.lat ?? null,
          lng: dto.lng ?? null,
          // undefined -> column default (Asia/Phnom_Penh, active)
          timezone: dto.timezone ?? undefined,
          isActive: dto.isActive ?? undefined,
        }),
      );
      // Every place gets a policy row; omitted fields take the column defaults.
      await m.insert(BookingPolicy, {
        placeId: place.id,
        ...definedOnly(dto.bookingPolicy ?? {}),
      });
      await this.replaceHours(m, place.id, dto.openingHours ?? []);
      await this.replaceClosures(m, place.id, dto.closures ?? []);
      return place.id;
    });
    this.logger.log(`Place created: id=${placeId} name=${dto.name}`);
    return this.detail(placeId, true);
  }

  async update(
    placeId: string,
    dto: UpdatePlaceDto,
  ): Promise<PlaceDetailResponseDto> {
    const cancelled = await this.transaction(async (m) => {
      // Row lock: concurrent PATCHes of one place run one after another, so
      // replacing hours/closures never interleaves.
      const place = await m
        .createQueryBuilder(Place, 'place')
        .setLock('pessimistic_write')
        .where('place.id = :placeId', { placeId })
        .getOne();
      if (!place) throw new NotFoundException('Place not found');
      if (
        place.externalSystem &&
        PARTNER_OWNED_FIELDS.some((f) => dto[f] !== undefined)
      )
        assertNotPartnerManaged(place);

      const wasActive = place.isActive;
      const { openingHours, closures, bookingPolicy, ...fields } = dto;
      Object.assign(place, definedOnly(fields));
      await m.save(place);
      if (place.externalSystem && place.isActive !== wasActive)
        await this.publishGoLive(m, place);

      if (openingHours) await this.replaceHours(m, placeId, openingHours);
      if (closures) await this.replaceClosures(m, placeId, closures);
      if (bookingPolicy) await this.mergePolicy(m, placeId, bookingPolicy);

      // Bookings the change makes impossible are cancelled now, in this
      // transaction, instead of expiring later as no-shows the user didn't cause.
      if (!this.bookingChanges) return 0;
      if (wasActive && !place.isActive)
        return this.bookingChanges.cancelAffected(m, placeId, 'all', 'PLACE_DEACTIVATED');
      if (place.isActive && (openingHours || closures))
        return this.bookingChanges.cancelAffected(m, placeId, 'outside-hours', 'HOURS_CHANGED');
      return 0;
    });
    const changed = Object.keys(dto).filter(
      (k) => dto[k as keyof UpdatePlaceDto] !== undefined,
    );
    this.logger.log(
      `Place updated: id=${placeId} fields=${changed.join(',') || 'none'} cancelledBookings=${cancelled}`,
    );
    return this.detail(placeId, true);
  }

  /**
   * Soft delete. PENDING bookings at the place are cancelled in the same
   * transaction; CHECKED_IN ones are left for staff to check out.
   * Seats of a deleted place already disappear from reads (seats checks places.deleted_at).
   */
  async softDelete(placeId: string): Promise<void> {
    const { place, cancelled } = await this.transaction(async (m) => {
      const place = await m
        .createQueryBuilder(Place, 'place')
        .setLock('pessimistic_write')
        .where('place.id = :placeId', { placeId })
        .getOne();
      if (!place) throw new NotFoundException('Place not found');
      assertNotPartnerManaged(place);
      await m.softDelete(Place, { id: placeId });
      const cancelled = this.bookingChanges
        ? await this.bookingChanges.cancelAffected(m, placeId, 'all', 'PLACE_DELETED')
        : 0;
      return { place, cancelled };
    });
    this.logger.log(
      `Place deleted: id=${placeId} name=${place.name} cancelledBookings=${cancelled}`,
    );
  }

  // includeInactive: admins still see (and edit) inactive places.
  private async detail(
    placeId: string,
    includeInactive: boolean,
  ): Promise<PlaceDetailResponseDto> {
    const place = await this.places.findOneBy(
      includeInactive ? { id: placeId } : { id: placeId, isActive: true },
    );
    if (!place) throw new NotFoundException('Place not found');
    const [hours, closures, policy] = await Promise.all([
      this.hours.find({ where: { placeId }, order: { weekday: 'ASC' } }),
      this.closures
        .createQueryBuilder('c')
        .where('c.placeId = :placeId', { placeId })
        // "today" is the place's local date, not the server's.
        .andWhere('c.date >= (now() AT TIME ZONE :tz)::date', {
          tz: place.timezone,
        })
        .orderBy('c.date')
        .getMany(),
      this.policies.findOneBy({ placeId }),
    ]);
    return toPlaceDetailResponse(place, hours, closures, policy);
  }

  /**
   * Our admin switched a partner-managed place on or off: tell the partner with
   * place.sync_applied for the current revision (docs/lms-integration-proposal.md
   * section 7.4.2), in the same transaction.
   */
  private async publishGoLive(m: EntityManager, place: Place): Promise<void> {
    // shortcut: reads seats directly; places can't import seats
    // (docs/project-structure.md section 3).
    const seats: { external_id: string; id: string }[] = await m.query(
      `SELECT external_id, id FROM seats
        WHERE place_id = $1 AND external_id IS NOT NULL AND deleted_at IS NULL
        ORDER BY label`,
      [place.id],
    );
    if (!this.outbox) return;
    await this.outbox.add(m, {
      aggregateType: 'place',
      aggregateId: place.id,
      eventType: MessageType.PLACE_SYNC_APPLIED,
      payload: {
        schemaVersion: 1,
        placeId: place.externalId!,
        revision: Number(place.externalRevision),
        sbPlaceId: place.id,
        bookingOpen: place.isActive && place.externalOpen === true,
        seats: seats.map((s) => ({ seatId: s.external_id, sbSeatId: s.id })),
        cancelledBookings: 0,
      },
    });
  }

  private async replaceHours(
    m: EntityManager,
    placeId: string,
    hours: OpeningHourDto[],
  ) {
    await m.delete(PlaceOpeningHour, { placeId });
    if (!hours.length) return;
    await m.insert(
      PlaceOpeningHour,
      hours.map((h) => ({
        placeId,
        weekday: h.weekday,
        openTime: h.openTime,
        closeTime: h.closeTime,
        closesNextDay: h.closesNextDay ?? false,
      })),
    );
  }

  private async replaceClosures(
    m: EntityManager,
    placeId: string,
    closures: ClosureDto[],
  ) {
    await m.delete(PlaceClosure, { placeId });
    if (!closures.length) return;
    await m.insert(
      PlaceClosure,
      closures.map((c) => ({
        placeId,
        date: c.date,
        reason: c.reason ?? null,
      })),
    );
  }

  private async mergePolicy(
    m: EntityManager,
    placeId: string,
    patch: BookingPolicyDto,
  ) {
    // Places created outside this API (older rows, fixtures) may lack a policy row.
    const policy =
      (await m.findOneBy(BookingPolicy, { placeId })) ??
      m.create(BookingPolicy, { placeId });
    Object.assign(policy, definedOnly(patch));
    await m.save(policy);
  }

  private async transaction<T>(
    work: (m: EntityManager) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.places.manager.transaction(work);
    } catch (err) {
      throw mapDbError(err);
    }
  }
}
