import { Injectable } from '@nestjs/common';
import { EntityManager, In } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm';
import { NotificationStatus, NotificationType } from '../../common/enums';
import { Notification } from '../entities/notification.entity';

export type NewNotification = Pick<
  Notification,
  'userId' | 'bookingId' | 'channel' | 'type' | 'scheduledAt' | 'payload'
>;

/** All writes take the caller's EntityManager so they join its transaction. */
@Injectable()
export class NotificationsRepository {
  /**
   * ON CONFLICT DO NOTHING: the (booking_id, type, channel) unique index makes
   * re-scheduling the same alert a no-op, so jobs can safely run again.
   */
  async insertIgnoringDuplicates(
    manager: EntityManager,
    rows: NewNotification[],
  ): Promise<void> {
    if (rows.length === 0) return;
    await manager
      .createQueryBuilder()
      .insert()
      .into(Notification)
      // TypeORM's deep-partial type can't map a Record<string, unknown> jsonb
      // column; the rows are exactly the entity's own column types.
      .values(rows as QueryDeepPartialEntity<Notification>[])
      .orIgnore()
      .execute();
  }

  async reschedulePending(
    manager: EntityManager,
    bookingIds: string[],
    type: NotificationType,
    scheduledAt: Date,
    payloadPatch?: Record<string, unknown>,
  ): Promise<void> {
    if (bookingIds.length === 0) return;
    // payload || patch: refresh the times the message shows, keep the rest.
    await manager
      .createQueryBuilder()
      .update(Notification)
      .set({
        scheduledAt,
        attempts: 0,
        lastError: null,
        ...(payloadPatch
          ? { payload: () => 'payload || CAST(:patch AS jsonb)' }
          : {}),
      })
      .where(
        'booking_id IN (:...bookingIds) AND type = :type AND status = :status',
        {
          bookingIds,
          type,
          status: NotificationStatus.PENDING,
        },
      )
      .setParameter('patch', JSON.stringify(payloadPatch ?? {}))
      .execute();
  }

  /**
   * Puts a once-per-booking alert back in the queue for each row, whatever its
   * current status (a reminder already SENT for the old end must fire again
   * for the new end), and inserts it where none exists yet (a booking that
   * was too short for one). Rows share one `type`. Run it on the transaction
   * that holds the booking rows locked, so no concurrent call can interleave.
   */
  async rearm(manager: EntityManager, rows: NewNotification[]): Promise<void> {
    if (rows.length === 0) return;
    const rearmed = new Set<string>();
    for (const row of rows) {
      // One UPDATE per booking: the payload (seat label, times) differs per row.
      const result = await manager
        .createQueryBuilder()
        .update(Notification)
        .set({
          status: NotificationStatus.PENDING,
          scheduledAt: row.scheduledAt,
          sentAt: null,
          attempts: 0,
          lastError: null,
          payload: () => 'payload || CAST(:patch AS jsonb)',
        })
        .where('booking_id = :bookingId AND type = :type AND channel = :channel', {
          bookingId: row.bookingId,
          type: row.type,
          channel: row.channel,
        })
        .setParameter('patch', JSON.stringify(row.payload))
        .execute();
      if (result.affected) rearmed.add(row.bookingId!);
    }
    await this.insertIgnoringDuplicates(
      manager,
      rows.filter((r) => !rearmed.has(r.bookingId!)),
    );
  }

  async skipPending(
    manager: EntityManager,
    bookingIds: string[],
    types?: NotificationType[],
  ): Promise<void> {
    if (bookingIds.length === 0) return;
    await manager.getRepository(Notification).update(
      {
        bookingId: In(bookingIds),
        status: NotificationStatus.PENDING,
        ...(types ? { type: In(types) } : {}),
      },
      { status: NotificationStatus.SKIPPED },
    );
  }

  /** Due rows, locked; SKIP LOCKED lets several app instances dispatch safely. */
  claimDue(
    manager: EntityManager,
    now: Date,
    limit: number,
  ): Promise<Notification[]> {
    return manager
      .getRepository(Notification)
      .createQueryBuilder('n')
      .where('n.status = :status', { status: NotificationStatus.PENDING })
      .andWhere('n.scheduledAt <= :now', { now })
      .orderBy('n.scheduledAt', 'ASC')
      .limit(limit)
      .setLock('pessimistic_write')
      .setOnLocked('skip_locked')
      .getMany();
  }

  /**
   * Reserves claimed rows for one dispatch run: scheduled_at = `until` keeps
   * them out of claimDue until then. The value doubles as the lease token the
   * result writes below are guarded by.
   */
  async lease(manager: EntityManager, ids: string[], until: Date): Promise<void> {
    if (ids.length === 0) return;
    await manager
      .getRepository(Notification)
      .update({ id: In(ids) }, { scheduledAt: until });
  }

  /**
   * Result writes only touch rows still PENDING under this run's lease. A row
   * that was re-armed, rescheduled or skipped while its message was being sent
   * has a new scheduled_at or status, and keeps it.
   */
  private leased(ids: string[], leasedUntil?: Date) {
    return {
      id: In(ids),
      ...(leasedUntil
        ? { status: NotificationStatus.PENDING, scheduledAt: leasedUntil }
        : {}),
    };
  }

  async markSent(
    manager: EntityManager,
    ids: string[],
    at: Date,
    leasedUntil?: Date,
  ): Promise<void> {
    await manager
      .getRepository(Notification)
      .update(this.leased(ids, leasedUntil), {
        status: NotificationStatus.SENT,
        sentAt: at,
        lastError: null,
      });
  }

  async markSkipped(
    manager: EntityManager,
    ids: string[],
    reason: string,
    leasedUntil?: Date,
  ): Promise<void> {
    await manager
      .getRepository(Notification)
      .update(this.leased(ids, leasedUntil), {
        status: NotificationStatus.SKIPPED,
        lastError: reason,
      });
  }

  /** `retryAt` null = give up (FAILED); otherwise stay PENDING until retryAt. */
  async recordFailure(
    manager: EntityManager,
    ids: string[],
    error: string,
    retryAt: Date | null,
    leasedUntil?: Date,
  ): Promise<void> {
    await manager
      .getRepository(Notification)
      .createQueryBuilder()
      .update(Notification)
      .set({
        attempts: () => 'attempts + 1',
        lastError: error.slice(0, 1000),
        ...(retryAt
          ? { scheduledAt: retryAt }
          : { status: NotificationStatus.FAILED }),
      })
      .where(this.leased(ids, leasedUntil))
      .execute();
  }

  /** Not attempted this run (the provider is rate limiting): due again at `at`, no attempt counted. */
  async defer(
    manager: EntityManager,
    ids: string[],
    at: Date,
    leasedUntil?: Date,
  ): Promise<void> {
    await manager
      .getRepository(Notification)
      .update(this.leased(ids, leasedUntil), { scheduledAt: at });
  }
}
