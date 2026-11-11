import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { NotificationChannel } from '../../common/enums';
import {
  NOTIFICATION_CHANNEL_STRATEGIES,
  NotificationChannelStrategy,
  RecipientUnreachableError,
  RenderedNotification,
} from '../channels/notification-channel.strategy';
import { OutboxService } from '../../messaging/outbox/outbox.service';
import { Notification } from '../entities/notification.entity';
import { NotificationsRepository } from '../repositories/notifications.repository';
import { buildAlertDueEvents } from './booking-alert-events';
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
  private readonly strategies: Map<
    NotificationChannel,
    NotificationChannelStrategy
  >;

  constructor(
    @Inject(NOTIFICATION_CHANNEL_STRATEGIES)
    strategies: NotificationChannelStrategy[],
    private readonly repository: NotificationsRepository,
    private readonly dataSource: DataSource,
    // From the global MessagingModule; optional so module-level tests without
    // messaging still compile. Publishes booking.alert_due.
    @Optional() private readonly outbox?: OutboxService,
  ) {
    this.strategies = new Map(strategies.map((s) => [s.channel, s]));
  }

  async dispatchDue(
    now: Date = new Date(),
    limit = DEFAULT_BATCH_SIZE,
  ): Promise<DispatchSummary> {
    // Rows stay locked (SKIP LOCKED for other instances) until the batch is recorded.
    return this.dataSource.transaction(async (manager) => {
      const summary: DispatchSummary = {
        sent: 0,
        skipped: 0,
        retrying: 0,
        failed: 0,
      };
      const due = await this.repository.claimDue(manager, now, limit);
      // The fact "this alert became due" goes to partners in the same
      // transaction that claims the rows, independent of delivery.
      if (this.outbox)
        for (const event of await buildAlertDueEvents(manager, due, now))
          await this.outbox.add(manager, event);
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
    // Ids, type and channel only: never the payload or the rendered text.
    const label = `${first.type} via ${first.channel} (notifications ${ids.join(', ')})`;

    const strategy = this.strategies.get(first.channel);
    // Rendering can throw on a malformed payload (e.g. an invalid date). It must
    // fail this batch only: an exception escaping here would roll back the whole
    // dispatch transaction, and batches already sent in it would be re-sent on
    // every run.
    let message: RenderedNotification | null;
    let renderError: string | null = null;
    try {
      message = renderNotification(first.type, mergePayloads(batch));
    } catch (err) {
      message = null;
      renderError = `Template failed: ${err instanceof Error ? err.message : 'unknown error'}`;
    }
    if (!strategy || !message) {
      // Configuration or data problem, not transient: don't retry.
      const reason = !strategy
        ? `No delivery strategy for channel ${first.channel}`
        : (renderError ?? `No template for type ${first.type}`);
      await this.repository.recordFailure(manager, ids, reason, null);
      summary.failed += batch.length;
      this.logger.error(`${label} failed permanently: ${reason}`);
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
        this.logger.log(
          `${label} skipped: user has no ${first.channel} destination`,
        );
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
        this.logger.log(`${label} skipped: ${reason}`);
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
      if (giveUp) {
        summary.failed += batch.length;
        this.logger.error(
          `${label} failed permanently after ${attempts} attempts: ${reason}`,
        );
      } else {
        summary.retrying += batch.length;
        this.logger.warn(
          `${label} failed (attempt ${attempts}/${MAX_ATTEMPTS}), will retry: ${reason}`,
        );
      }
    }
  }
}
