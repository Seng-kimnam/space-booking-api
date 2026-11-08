import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { NotificationChannel } from '../../common/enums';
import {
  NOTIFICATION_CHANNEL_STRATEGIES,
  NotificationChannelStrategy,
  RecipientUnreachableError,
} from '../channels/notification-channel.strategy';
import { Notification } from '../entities/notification.entity';
import { NotificationsRepository } from '../repositories/notifications.repository';
import {
  BookingAlertPayload,
  renderNotification,
} from '../templates/notification-templates';

export const MAX_ATTEMPTS = 5;
const DEFAULT_BATCH_SIZE = 50;

export interface DispatchSummary {
  sent: number;
  skipped: number;
  retrying: number;
  failed: number;
}

/**
 * Rows of one multi-seat booking (same user, channel, type and groupId) are
 * delivered as ONE message listing every seat. Rows without a groupId go alone.
 */
export function groupForDelivery(rows: Notification[]): Notification[][] {
  const batches = new Map<string, Notification[]>();
  for (const row of rows) {
    const groupId =
      typeof row.payload?.groupId === 'string' ? row.payload.groupId : row.id;
    const key = `${row.userId}|${row.channel}|${row.type}|${groupId}`;
    const batch = batches.get(key);
    if (batch) batch.push(row);
    else batches.set(key, [row]);
  }
  return [...batches.values()];
}

/** First row's payload, with the seat labels of the whole batch. */
export function mergePayloads(batch: Notification[]): BookingAlertPayload {
  const base = batch[0].payload as BookingAlertPayload;
  const labels = batch.flatMap(
    (n) => (n.payload as BookingAlertPayload).seatLabels ?? [],
  );
  return { ...base, seatLabels: [...new Set(labels)].sort() };
}

/** Exponential backoff after the n-th failed attempt: 1, 2, 4, 8... minutes, capped at 60. */
export function nextAttemptAt(now: Date, attemptsSoFar: number): Date {
  const minutes = Math.min(2 ** Math.max(attemptsSoFar - 1, 0), 60);
  return new Date(now.getTime() + minutes * 60_000);
}

/**
 * Sends due `notifications` through the strategy registered for their channel.
 * Called by the notification-dispatch job. It never talks to a provider
 * directly, so adding a channel needs no change here.
 */
@Injectable()
export class NotificationDispatcher {
  private readonly logger = new Logger(NotificationDispatcher.name);
  private readonly strategies: Map<NotificationChannel, NotificationChannelStrategy>;

  constructor(
    @Inject(NOTIFICATION_CHANNEL_STRATEGIES)
    strategies: NotificationChannelStrategy[],
    private readonly repository: NotificationsRepository,
    private readonly dataSource: DataSource,
  ) {
    this.strategies = new Map(strategies.map((s) => [s.channel, s]));
  }

  async dispatchDue(
    now: Date = new Date(),
    limit = DEFAULT_BATCH_SIZE,
  ): Promise<DispatchSummary> {
    // Rows stay locked (SKIP LOCKED for other instances) until the batch is recorded.
    return this.dataSource.transaction(async (manager) => {
      const summary: DispatchSummary = { sent: 0, skipped: 0, retrying: 0, failed: 0 };
      const due = await this.repository.claimDue(manager, now, limit);
      for (const batch of groupForDelivery(due)) {
        await this.deliver(manager, batch, now, summary);
      }
      return summary;
    });
  }

  private async deliver(
    manager: EntityManager,
    batch: Notification[],
    now: Date,
    summary: DispatchSummary,
  ): Promise<void> {
    const first = batch[0];
    const ids = batch.map((n) => n.id);

    const strategy = this.strategies.get(first.channel);
    const message = renderNotification(first.type, mergePayloads(batch));
    if (!strategy || !message) {
      // Configuration problem, not transient: don't retry.
      await this.repository.recordFailure(
        manager,
        ids,
        !strategy
          ? `No delivery strategy for channel ${first.channel}`
          : `No template for type ${first.type}`,
        null,
      );
      summary.failed += batch.length;
      return;
    }

    try {
      if (!(await strategy.isAvailableFor(first.userId))) {
        await this.repository.markSkipped(
          manager,
          ids,
          `User has no ${first.channel} destination`,
        );
        summary.skipped += batch.length;
        return;
      }
      await strategy.send(first.userId, message);
      await this.repository.markSent(manager, ids, now);
      summary.sent += batch.length;
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'unknown error';
      if (err instanceof RecipientUnreachableError) {
        await this.repository.markSkipped(manager, ids, reason);
        summary.skipped += batch.length;
        return;
      }
      const attempts = first.attempts + 1;
      const giveUp = attempts >= MAX_ATTEMPTS;
      await this.repository.recordFailure(
        manager,
        ids,
        reason,
        giveUp ? null : nextAttemptAt(now, attempts),
      );
      if (giveUp) summary.failed += batch.length;
      else summary.retrying += batch.length;
      this.logger.warn(
        `${first.type} via ${first.channel} failed (attempt ${attempts}/${MAX_ATTEMPTS}): ${reason}`,
      );
    }
  }
}
