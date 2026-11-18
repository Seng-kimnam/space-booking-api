import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { NotificationChannel } from '../../common/enums';
import {
  NOTIFICATION_CHANNEL_STRATEGIES,
  NotificationChannelStrategy,
  RateLimitedError,
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
 * How long claimed rows are reserved for this run while their messages go out
 * (outside any transaction). If the process dies before recording the result,
 * the rows become due again after the lease: at-least-once delivery.
 */
export const LEASE_MS = 2 * 60_000;

/**
 * Sends due `notifications` through the strategy registered for their channel.
 * Called by the notification-dispatch job. It never talks to a provider
 * directly, so adding a channel needs no change here.
 *
 * Lease pattern: rows are claimed and leased in one short transaction, sent
 * with no transaction open (a slow provider never holds DB locks), and each
 * batch's outcome is recorded in its own small transaction, guarded by the
 * lease so a row re-armed or rescheduled meanwhile isn't overwritten.
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
    const summary: DispatchSummary = {
      sent: 0,
      skipped: 0,
      retrying: 0,
      failed: 0,
    };
    const leasedUntil = new Date(now.getTime() + LEASE_MS);
    // 1. Claim (SKIP LOCKED) and lease: scheduled_at = leasedUntil keeps other
    // runs and instances off these rows after this commit.
    const due = await this.dataSource.transaction(async (manager) => {
      const rows = await this.repository.claimDue(manager, now, limit);
      if (rows.length === 0) return rows;
      await this.repository.lease(
        manager,
        rows.map((n) => n.id),
        leasedUntil,
      );
      // The fact "this alert became due" goes to partners in the same
      // transaction that claims the rows, independent of delivery.
      if (this.outbox)
        for (const event of await buildAlertDueEvents(manager, rows, now))
          await this.outbox.add(manager, event);
      return rows;
    });

    // 2 + 3. Send each batch with no transaction open; record its result.
    const throttled = new Map<NotificationChannel, Date>();
    for (const batch of groupForDelivery(due)) {
      const retryAt = throttled.get(batch[0].channel);
      if (retryAt) {
        // The provider said to slow down: don't send the rest of this run.
        await this.record((m) =>
          this.repository.defer(m, batch.map((n) => n.id), retryAt, leasedUntil),
        );
        summary.retrying += batch.length;
        continue;
      }
      await this.deliver(batch, now, leasedUntil, summary, throttled);
    }
    return summary;
  }

  private record(work: (m: EntityManager) => Promise<void>): Promise<void> {
    return this.dataSource.transaction(work);
  }

  private async deliver(
    batch: Notification[],
    now: Date,
    leasedUntil: Date,
    summary: DispatchSummary,
    throttled: Map<NotificationChannel, Date>,
  ): Promise<void> {
    const first = batch[0];
    const ids = batch.map((n) => n.id);
    // Ids, type and channel only: never the payload or the rendered text.
    const label = `${first.type} via ${first.channel} (notifications ${ids.join(', ')})`;

    const strategy = this.strategies.get(first.channel);
    // Rendering can throw on a malformed payload (e.g. an invalid date). It must
    // fail this batch only, never the rest of the run.
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
      await this.record((m) =>
        this.repository.recordFailure(m, ids, reason, null, leasedUntil),
      );
      summary.failed += batch.length;
      this.logger.error(`${label} failed permanently: ${reason}`);
      return;
    }

    try {
      // send() looks up the destination itself and throws
      // RecipientUnreachableError when there is none (no separate lookup).
      await strategy.send(first.userId, message);
    } catch (err) {
      await this.recordSendError(err, batch, now, leasedUntil, label, summary, throttled);
      return;
    }
    await this.record((m) =>
      this.repository.markSent(m, ids, now, leasedUntil),
    );
    summary.sent += batch.length;
  }

  private async recordSendError(
    err: unknown,
    batch: Notification[],
    now: Date,
    leasedUntil: Date,
    label: string,
    summary: DispatchSummary,
    throttled: Map<NotificationChannel, Date>,
  ): Promise<void> {
    const first = batch[0];
    const ids = batch.map((n) => n.id);
    const reason = err instanceof Error ? err.message : 'unknown error';
    if (err instanceof RecipientUnreachableError) {
      await this.record((m) =>
        this.repository.markSkipped(m, ids, reason, leasedUntil),
      );
      summary.skipped += batch.length;
      this.logger.log(`${label} skipped: ${reason}`);
      return;
    }
    const attempts = first.attempts + 1;
    const giveUp = attempts >= MAX_ATTEMPTS;
    let retryAt = giveUp ? null : nextAttemptAt(now, attempts);
    if (err instanceof RateLimitedError) {
      // Honour the provider's retry_after, and stop this channel for the run.
      const notBefore = new Date(now.getTime() + err.retryAfterMs);
      if (retryAt && notBefore > retryAt) retryAt = notBefore;
      throttled.set(first.channel, retryAt ?? notBefore);
    }
    await this.record((m) =>
      this.repository.recordFailure(m, ids, reason, retryAt, leasedUntil),
    );
    if (!retryAt) {
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
