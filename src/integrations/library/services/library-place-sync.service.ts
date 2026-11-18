import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, IsNull, Not, Repository } from 'typeorm';
import { Area } from '../../../areas/entities/area.entity';
import { BookingsRepository } from '../../../bookings/repositories/bookings.repository';
import { BookingsService } from '../../../bookings/services/bookings.service';
import { PlaceType, SeatStatus } from '../../../common/enums';
import type { IncomingEnvelope } from '../../../messaging/consumers/consumer-route';
import { MessageType } from '../../../messaging/contract/schemas';
import type {
  PlaceSnapshotV1,
  PlaceSyncAppliedV1,
  PlaceSyncRejectedV1,
} from '../../../messaging/contract/types';
import { OutboxService } from '../../../messaging/outbox/outbox.service';
import { BookingPolicy } from '../../../places/entities/booking-policy.entity';
import { PlaceClosure } from '../../../places/entities/place-closure.entity';
import { PlaceOpeningHour } from '../../../places/entities/place-opening-hour.entity';
import { Place } from '../../../places/entities/place.entity';
import { OpeningHoursService } from '../../../places/services/opening-hours.service';
import { Seat } from '../../../seats/entities/seat.entity';
import { checkSnapshot, SnapshotRejection, TEMP_PREFIX, toDbTime } from '../domain/place-snapshot.rules';
import { LIBRARY_SYSTEM } from '../library.constants';

export type SyncOutcome =
  | { result: 'applied'; placeId: string; cancelledBookings: number }
  | { result: 'stale' }
  | { result: 'rejected'; code: string };

/** booking_events.metadata.subReason when a sync cancels a booking. */
type PlaceChangeReason = 'SEAT_REMOVED' | 'SEAT_NOT_ACTIVE' | 'PLACE_NOT_OPEN' | 'OUTSIDE_OPENING_HOURS';

/** A row LMS owns, matched by its external id. */
type ExternalRow = { id: string; externalId: string | null; deletedAt: Date | null };

const isBookingOpen = (place: Place): boolean => place.isActive && place.externalOpen === true;

/**
 * Applies an LMS place snapshot inside the inbox transaction, then replies
 * with place.sync_applied, or place.sync_rejected if it breaks our rules.
 *
 * Writes rows directly instead of going through the Places/Areas/Seats
 * services: a snapshot must land as one unit, with label swaps and
 * restore-by-external-id that the admin services don't support.
 */
@Injectable()
export class LibraryPlaceSyncService {
  private readonly logger = new Logger(LibraryPlaceSyncService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly outbox: OutboxService,
    private readonly bookings: BookingsService,
    private readonly bookingsRepository: BookingsRepository,
    private readonly openingHours: OpeningHoursService,
  ) {}

  async apply(
    manager: EntityManager,
    envelope: IncomingEnvelope,
    now = new Date(),
  ): Promise<SyncOutcome> {
    const s = envelope.data as unknown as PlaceSnapshotV1;

    // Serializes snapshots of one place; a brand-new place is serialized by
    // places_external_uk (the loser's insert fails and is retried).
    const place = await manager
      .getRepository(Place)
      .createQueryBuilder('p')
      .withDeleted()
      .setLock('pessimistic_write')
      .where('p.external_system = :system AND p.external_id = :id', {
        system: LIBRARY_SYSTEM,
        id: s.placeId,
      })
      .getOne();

    if (place && Number(place.externalRevision) >= s.revision) {
      this.logger.log(`Stale snapshot ignored: lms place=${s.placeId} revision=${s.revision} (have ${place.externalRevision})`);
      return { result: 'stale' };
    }

    const rejection =
      checkSnapshot(s) ??
      (place?.deletedAt
        ? { code: 'OTHER' as const, message: 'Place was deleted in Space Booking', details: [] }
        : null) ??
      (place ? await this.checkUnmanagedConflicts(manager, place.id, s) : null);
    if (rejection) {
      await this.reject(manager, envelope, s, place?.id ?? null, rejection);
      return { result: 'rejected', code: rejection.code };
    }

    const target = place ?? (await this.createPlace(manager, s));
    await this.updatePlace(manager, target, s);
    await this.replaceHours(manager, target.id, s);
    await this.replaceFutureClosures(manager, target, s);
    const areaIds = await this.syncAreas(manager, target.id, s);
    const seatIds = await this.syncSeats(manager, target.id, s, areaIds);
    await this.removeMissingAreas(manager, target.id, s);
    const cancelled = await this.cancelAffectedBookings(manager, target, now);

    const reply: PlaceSyncAppliedV1 = {
      placeId: s.placeId,
      revision: s.revision,
      sbPlaceId: target.id,
      bookingOpen: isBookingOpen(target),
      seats: s.seats.map((x) => ({ seatId: x.seatId, sbSeatId: seatIds.get(x.seatId)! })),
      cancelledBookings: cancelled,
    };
    await this.outbox.add(manager, {
      aggregateType: 'place',
      aggregateId: target.id,
      eventType: MessageType.PLACE_SYNC_APPLIED,
      payload: { schemaVersion: 1, ...reply },
    });
    this.logger.log(
      `LMS place synced: place=${target.id} lms=${s.placeId} revision=${s.revision} seats=${s.seats.length} cancelled=${cancelled}`,
    );
    return { result: 'applied', placeId: target.id, cancelledBookings: cancelled };
  }

  /** What the last place.sync_applied said about an LMS place. 404 if never applied. */
  async status(lmsPlaceId: string): Promise<Omit<PlaceSyncAppliedV1, 'cancelledBookings'>> {
    const m = this.dataSource.manager;
    const place = await m
      .getRepository(Place)
      .findOneBy({ externalSystem: LIBRARY_SYSTEM, externalId: lmsPlaceId });
    if (!place) throw new NotFoundException('Place not synced');
    const seats = await m.getRepository(Seat).find({
      where: { placeId: place.id, externalId: Not(IsNull()) },
      order: { label: 'ASC' },
    });
    return {
      placeId: lmsPlaceId,
      revision: Number(place.externalRevision),
      sbPlaceId: place.id,
      bookingOpen: isBookingOpen(place),
      seats: seats.map((x) => ({ seatId: x.externalId!, sbSeatId: x.id })),
    };
  }

  /** Rows our admins made before LMS took the place over must not clash with snapshot labels or names. */
  private async checkUnmanagedConflicts(
    manager: EntityManager,
    placeId: string,
    s: PlaceSnapshotV1,
  ): Promise<SnapshotRejection | null> {
    // An empty `where` array would match any row, so only query when there is something to compare.
    const seat =
      s.seats.length > 0
        ? await manager.getRepository(Seat).findOne({
            where: s.seats.map((x) => ({ placeId, externalId: IsNull(), label: x.label })),
          })
        : null;
    if (seat) {
      const i = s.seats.findIndex((x) => x.label === seat.label);
      return {
        code: 'SEAT_LABEL_CONFLICT',
        message: `Seat label ${seat.label} is used by a seat Space Booking manages`,
        details: [{ path: `seats[${i}].label`, value: seat.label }],
      };
    }
    const area =
      s.areas.length > 0
        ? await manager.getRepository(Area).findOne({
            where: s.areas.map((a) => ({ placeId, externalId: IsNull(), name: a.name })),
          })
        : null;
    if (area) {
      const i = s.areas.findIndex((a) => a.name === area.name);
      return {
        code: 'AREA_NAME_CONFLICT',
        message: `Area name ${area.name} is used by an area Space Booking manages`,
        details: [{ path: `areas[${i}].name`, value: area.name }],
      };
    }
    return null;
  }

  private async reject(
    manager: EntityManager,
    envelope: IncomingEnvelope,
    s: PlaceSnapshotV1,
    placeId: string | null,
    rejection: SnapshotRejection,
  ): Promise<void> {
    const reply: PlaceSyncRejectedV1 = {
      placeId: s.placeId,
      revision: s.revision,
      code: rejection.code,
      message: rejection.message.slice(0, 500),
      details: rejection.details,
    };
    await this.outbox.add(manager, {
      aggregateType: 'place',
      // aggregate_id is a uuid: our place id if we have one, else the message id.
      aggregateId: placeId ?? envelope.id,
      eventType: MessageType.PLACE_SYNC_REJECTED,
      payload: { schemaVersion: 1, ...reply },
    });
    this.logger.warn(
      `LMS place snapshot rejected: lms=${s.placeId} revision=${s.revision} code=${rejection.code}`,
    );
  }

  /** New LMS places start inactive until our admin reviews the policy (D12). */
  private async createPlace(manager: EntityManager, s: PlaceSnapshotV1): Promise<Place> {
    const place = await manager.save(
      manager.create(Place, {
        name: s.name,
        type: PlaceType.LIBRARY,
        address: s.address,
        timezone: s.timezone,
        isActive: false,
        externalSystem: LIBRARY_SYSTEM,
        externalId: s.placeId,
        externalRevision: '0',
        externalOpen: false,
      }),
    );
    // Default policy (column defaults), same as admin-created places.
    await manager.insert(BookingPolicy, { placeId: place.id });
    this.logger.log(`LMS place created: place=${place.id} lms=${s.placeId} (inactive until an admin activates it)`);
    return place;
  }

  private async updatePlace(manager: EntityManager, place: Place, s: PlaceSnapshotV1): Promise<void> {
    place.name = s.name;
    place.description = s.description;
    place.address = s.address;
    place.lat = s.lat;
    place.lng = s.lng;
    place.timezone = s.timezone;
    place.externalRevision = String(s.revision);
    place.externalOpen = s.status === 'ACTIVE' && s.bookingEnabled;
    await manager.save(place);
  }

  private async replaceHours(manager: EntityManager, placeId: string, s: PlaceSnapshotV1): Promise<void> {
    await manager.delete(PlaceOpeningHour, { placeId });
    if (s.openingHours.length === 0) return;
    await manager.insert(
      PlaceOpeningHour,
      s.openingHours.map((h) => ({
        placeId,
        weekday: h.weekday,
        openTime: toDbTime(h.open),
        closeTime: toDbTime(h.close),
        closesNextDay: h.closesNextDay,
      })),
    );
  }

  /** Replaces closures from place-local today on; past rows are history and stay. */
  private async replaceFutureClosures(manager: EntityManager, place: Place, s: PlaceSnapshotV1): Promise<void> {
    const [{ today }]: { today: string }[] = await manager.query(
      `SELECT to_char((now() AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS today`,
      [place.timezone],
    );
    await manager
      .createQueryBuilder()
      .delete()
      .from(PlaceClosure)
      .where('place_id = :placeId AND date >= :today', { placeId: place.id, today })
      .execute();
    const future = s.closures.filter((c) => c.date >= today);
    if (future.length === 0) return;
    await manager.insert(
      PlaceClosure,
      future.map((c) => ({ placeId: place.id, date: c.date, reason: c.reason })),
    );
  }

  /** Returns LMS area id -> our area id. */
  private async syncAreas(manager: EntityManager, placeId: string, s: PlaceSnapshotV1): Promise<Map<string, string>> {
    const repo = manager.getRepository(Area);
    const existing = await repo.find({ where: { placeId, externalId: Not(IsNull()) }, withDeleted: true });
    return this.upsertByExternalId(
      repo,
      placeId,
      existing,
      'name',
      s.areas.map((a) => ({
        externalId: a.areaId,
        values: { name: a.name, floor: a.floor, description: a.description, isActive: a.status === 'ACTIVE' },
      })),
    );
  }

  /** Returns LMS seat id -> our seat id. Seats LMS no longer sends are soft-deleted. */
  private async syncSeats(
    manager: EntityManager,
    placeId: string,
    s: PlaceSnapshotV1,
    areaIds: Map<string, string>,
  ): Promise<Map<string, string>> {
    const repo = manager.getRepository(Seat);
    const existing = await repo.find({ where: { placeId, externalId: Not(IsNull()) }, withDeleted: true });
    const ids = await this.upsertByExternalId(
      repo,
      placeId,
      existing,
      'label',
      s.seats.map((x) => ({
        externalId: x.seatId,
        values: {
          label: x.label,
          areaId: x.areaId === null ? null : areaIds.get(x.areaId)!,
          features: x.features,
          status: x.status as SeatStatus,
        },
      })),
    );

    // Soft delete, so booking history keeps pointing at the row.
    const removed = existing.filter((x) => !x.deletedAt && !ids.has(x.externalId!)).map((x) => x.id);
    if (removed.length > 0) await repo.softDelete(removed);
    return ids;
  }

  /**
   * Upserts rows by external id, restoring soft-deleted ones. Live rows that
   * get renamed or removed first move to a temporary value, so swaps
   * (A1 <-> A2) never hit the unique index mid-update.
   */
  private async upsertByExternalId<T extends ExternalRow & Record<F, string>, F extends 'name' | 'label'>(
    repo: Repository<T>,
    placeId: string,
    existing: T[],
    uniqueField: F,
    wanted: { externalId: string; values: Record<F, string> & Record<string, unknown> }[],
  ): Promise<Map<string, string>> {
    type Update = Parameters<Repository<T>['update']>[1];
    type Insert = Parameters<Repository<T>['insert']>[0];
    const byExternal = new Map(existing.map((row) => [row.externalId!, row]));
    const wantedById = new Map(wanted.map((w) => [w.externalId, w.values]));

    // Soft-delete rows LMS no longer sends before touching any label: deleted
    // rows leave the partial unique index, so a new row may reuse the label,
    // and history keeps the real label instead of a temporary one.
    const removed = existing.filter((row) => !row.deletedAt && !wantedById.has(row.externalId!));
    if (removed.length > 0) {
      await repo.softDelete(removed.map((row) => row.id));
      for (const row of removed) row.deletedAt = new Date();
    }

    let n = 0;
    for (const row of existing) {
      if (row.deletedAt) continue;
      const next = wantedById.get(row.externalId!);
      // Rows that stay but change name/label move aside first, so swaps don't
      // collide with the unique index mid-update. Removed rows are already gone.
      if (next && next[uniqueField] !== row[uniqueField]) {
        const temp: Record<string, unknown> = { [uniqueField]: `${TEMP_PREFIX}${n++}` };
        await repo.update(row.id, temp as Update);
      }
    }

    const ids = new Map<string, string>();
    for (const { externalId, values } of wanted) {
      const row = { ...values, deletedAt: null };
      const found = byExternal.get(externalId);
      if (found) {
        await repo.update(found.id, row as Update);
        ids.set(externalId, found.id);
      } else {
        const inserted = await repo.insert({ placeId, externalId, ...row } as Insert);
        ids.set(externalId, inserted.identifiers[0].id as string);
      }
    }
    return ids;
  }

  /** After seats moved: soft-delete LMS areas no longer sent, unless a live seat still uses one. */
  private async removeMissingAreas(manager: EntityManager, placeId: string, s: PlaceSnapshotV1): Promise<void> {
    const keep = s.areas.map((a) => a.areaId);
    const rows: { id: string }[] = await manager.query(
      `SELECT a.id FROM areas a
        WHERE a.place_id = $1 AND a.external_id IS NOT NULL AND a.deleted_at IS NULL
          AND NOT (a.external_id = ANY($2::varchar[]))
          AND NOT EXISTS (SELECT 1 FROM seats s WHERE s.area_id = a.id AND s.deleted_at IS NULL)`,
      [placeId, keep],
    );
    if (rows.length > 0) await manager.getRepository(Area).softDelete(rows.map((r) => r.id));
  }

  /**
   * System-cancels future PENDING bookings the new state makes impossible (D4).
   * CHECKED_IN and CHECKOUT_OVERDUE bookings are never touched.
   */
  private async cancelAffectedBookings(manager: EntityManager, place: Place, now: Date): Promise<number> {
    const pending = await this.bookingsRepository.lockFuturePendingAtPlace(manager, place.id, now);
    if (pending.length === 0) return 0;

    const seats = await manager.getRepository(Seat).find({
      where: { placeId: place.id },
      withDeleted: true,
      select: { id: true, status: true, deletedAt: true },
    });
    const seatById = new Map(seats.map((x) => [x.id, x]));

    const cancellations: { bookingId: string; subReason: PlaceChangeReason }[] = [];
    for (const b of pending) {
      const seat = seatById.get(b.seatId);
      let reason: PlaceChangeReason | null = null;
      if (!seat || seat.deletedAt) reason = 'SEAT_REMOVED';
      else if (seat.status !== SeatStatus.ACTIVE) reason = 'SEAT_NOT_ACTIVE';
      else if (place.externalOpen !== true) reason = 'PLACE_NOT_OPEN';
      else if (
        !(await this.openingHours.isOpenForRange(place.id, b.timeRange.start, b.timeRange.end, manager))
      )
        reason = 'OUTSIDE_OPENING_HOURS';
      if (reason) cancellations.push({ bookingId: b.id, subReason: reason });
    }
    return this.bookings.cancelForPartnerChange(manager, cancellations, now);
  }
}
