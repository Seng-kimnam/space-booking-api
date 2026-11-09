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
        ...(payloadPatch ? { payload: () => 'payload || CAST(:patch AS jsonb)' } : {}),
      })
      .where('booking_id IN (:...bookingIds) AND type = :type AND status = :status', {
        bookingIds,
        type,
        status: NotificationStatus.PENDING,
      })
      .setParameter('patch', JSON.stringify(payloadPatch ?? {}))
      .execute();
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

  async markSent(manager: EntityManager, ids: string[], at: Date): Promise<void> {
    await manager.getRepository(Notification).update(
      { id: In(ids) },
      { status: NotificationStatus.SENT, sentAt: at, lastError: null },
    );
  }

  async markSkipped(
    manager: EntityManager,
    ids: string[],
    reason: string,
  ): Promise<void> {
    await manager
      .getRepository(Notification)
      .update({ id: In(ids) }, { status: NotificationStatus.SKIPPED, lastError: reason });
  }

  /** `retryAt` null = give up (FAILED); otherwise stay PENDING until retryAt. */
  async recordFailure(
    manager: EntityManager,
    ids: string[],
    error: string,
    retryAt: Date | null,
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
      .where({ id: In(ids) })
      .execute();
  }
}
