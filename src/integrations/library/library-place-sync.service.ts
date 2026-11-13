import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, IsNull, Not } from 'typeorm';
import { Area } from '../../areas/entities/area.entity';
import { BookingsRepository } from '../../bookings/repositories/bookings.repository';
import { BookingsService } from '../../bookings/services/bookings.service';
import { PlaceType, SeatStatus } from '../../common/enums';
import type {
  PlaceSnapshotV1,
  PlaceSyncAppliedV1,
  PlaceSyncRejectedV1,
} from '../../messaging/contract/types';
import type { IncomingEnvelope } from '../../messaging/consumers/consumer-route';
import { OutboxService } from '../../messaging/outbox/outbox.service';
import { BookingPolicy } from '../../places/entities/booking-policy.entity';
import { PlaceClosure } from '../../places/entities/place-closure.entity';
import { PlaceOpeningHour } from '../../places/entities/place-opening-hour.entity';
import { Place } from '../../places/entities/place.entity';
import { OpeningHoursService } from '../../places/services/opening-hours.service';
import { Seat } from '../../seats/entities/seat.entity';
import { LIBRARY_SYSTEM, LibraryRoutingKey, PlaceChangeReason } from './library.constants';
import { checkSnapshot, SnapshotRejection, TEMP_PREFIX, toDbTime } from './place-snapshot.rules';

export type SyncOutcome =
  | { result: 'applied'; placeId: string; cancelledBookings: number }
  | { result: 'stale' }
  | { result: 'rejected'; code: string };

/**
 * Applies an LMS place snapshot (place.created / place.updated) inside the
 * inbox transaction (docs/lms-integration-proposal.md section 6.1):
 * place, opening hours, future closures, areas, seats, then system-cancels the
 * future PENDING bookings the change makes impossible, then writes the
 * place.sync_applied reply. A snapshot that breaks our rules is not applied:
 * the reply is place.sync_rejected and the message is acked.
 *
 * shortcut: writes places/areas/seats rows directly on the manager instead of
 * through PlacesService/AreasService/SeatsService (docs/project-structure.md
 * section 3). Those services validate admin DTOs one row at a time and run
 * their own transactions; a snapshot must be applied as one unit, with
 * the two-step label swap and soft-delete/restore by external id.
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
      bookingOpen: target.isActive && target.externalOpen === true,
      seats: s.seats.map((x) => ({ seatId: x.seatId, sbSeatId: seatIds.get(x.seatId)! })),
      cancelledBookings: cancelled,
    };
    await this.outbox.add(manager, {
      aggregateType: 'place',
      aggregateId: target.id,
      eventType: LibraryRoutingKey.SYNC_APPLIED,
      payload: { schemaVersion: 1, ...reply },
    });
    this.logger.log(
      `LMS place synced: place=${target.id} lms=${s.placeId} revision=${s.revision} seats=${s.seats.length} cancelled=${cancelled}`,
    );
    return { result: 'applied', placeId: target.id, cancelledBookings: cancelled };
  }

  /** Current sync state of an LMS place (what its last place.sync_applied said). 404 if never applied. */
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
      bookingOpen: place.isActive && place.externalOpen === true,
      seats: seats.map((x) => ({ seatId: x.externalId!, sbSeatId: x.id })),
    };
  }

  /**
   * Rows our admins created in this place before LMS took it over (no
   * external_id) must not clash with snapshot labels or names.
   */
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
      // Our place id when we have one; else the message id (aggregate_id is a uuid).
      // The envelope subject is the LMS place id either way (envelope.ts).
      aggregateId: placeId ?? envelope.id,
      eventType: LibraryRoutingKey.SYNC_REJECTED,
      payload: { schemaVersion: 1, ...reply },
    });
    this.logger.warn(
      `LMS place snapshot rejected: lms=${s.placeId} revision=${s.revision} code=${rejection.code}`,
    );
  }

  /** New LMS place: not live until our admin reviews the policy and activates it (D12). */
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
    // Default policy (column defaults), as for places created by our admins.
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

  /** Upserts areas by external id (restoring soft-deleted ones). Returns LMS area id -> our id. */
  private async syncAreas(manager: EntityManager, placeId: string, s: PlaceSnapshotV1): Promise<Map<string, string>> {
    const repo = manager.getRepository(Area);
    const existing = await repo.find({ where: { placeId, externalId: Not(IsNull()) }, withDeleted: true });
    const byExternal = new Map(existing.map((a) => [a.externalId!, a]));
    const wanted = new Map(s.areas.map((a) => [a.areaId, a]));

    // Step 1: live areas that get renamed or removed move to a temporary name,
    // so swaps and reuse of a removed area's name never hit areas_place_name_uk.
    let n = 0;
    for (const area of existing) {
      if (area.deletedAt) continue;
      const next = wanted.get(area.externalId!);
      if (!next || next.name !== area.name) {
        await repo.update(area.id, { name: `${TEMP_PREFIX}${n++}` });
      }
    }

    // Step 2: final values; restore what comes back, insert what's new.
    const ids = new Map<string, string>();
    for (const a of s.areas) {
      const values = {
        name: a.name,
        floor: a.floor,
        description: a.description,
        isActive: a.status === 'ACTIVE',
        deletedAt: null,
      };
      const found = byExternal.get(a.areaId);
      if (found) {
        await repo.update(found.id, values);
        ids.set(a.areaId, found.id);
      } else {
        const inserted = await repo.insert({ placeId, externalId: a.areaId, ...values });
        ids.set(a.areaId, inserted.identifiers[0].id as string);
      }
    }
    return ids;
  }

  /** Upserts seats by external id, two-step labels, soft-deletes missing ones. Returns LMS seat id -> our id. */
  private async syncSeats(
    manager: EntityManager,
    placeId: string,
    s: PlaceSnapshotV1,
    areaIds: Map<string, string>,
  ): Promise<Map<string, string>> {
    const repo = manager.getRepository(Seat);
    const existing = await repo.find({ where: { placeId, externalId: Not(IsNull()) }, withDeleted: true });
    const byExternal = new Map(existing.map((x) => [x.externalId!, x]));
    const wanted = new Map(s.seats.map((x) => [x.seatId, x]));

    let n = 0;
    for (const seat of existing) {
      if (seat.deletedAt) continue;
      const next = wanted.get(seat.externalId!);
      if (!next || next.label !== seat.label) {
        await repo.update(seat.id, { label: `${TEMP_PREFIX}${n++}` });
      }
    }

    const ids = new Map<string, string>();
    for (const x of s.seats) {
      const values = {
        label: x.label,
        areaId: x.areaId === null ? null : areaIds.get(x.areaId)!,
        features: x.features,
        status: x.status as SeatStatus,
        deletedAt: null,
      };
      const found = byExternal.get(x.seatId);
      if (found) {
        await repo.update(found.id, values);
        ids.set(x.seatId, found.id);
      } else {
        const inserted = await repo.insert({ placeId, externalId: x.seatId, ...values });
        ids.set(x.seatId, inserted.identifiers[0].id as string);
      }
    }

    // Removed from LMS: soft delete; booking history keeps pointing at the row.
    const removed = existing.filter((x) => !x.deletedAt && !wanted.has(x.externalId!)).map((x) => x.id);
    if (removed.length > 0) await repo.softDelete(removed);
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
   * Future PENDING bookings the new state makes impossible are cancelled by the
   * system (D4). CHECKED_IN and CHECKOUT_OVERDUE bookings are never touched.
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
