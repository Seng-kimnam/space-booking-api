import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import type {
  ActivityActor,
  UserActivityItem,
  UserBookingSummary,
  UserBookingsPort,
} from '../../users/users.ports';
import { BookingsRepository } from '../repositories/bookings.repository';
import { BookingCancellationService } from './booking-cancellation.service';

/**
 * The users module's USER_BOOKINGS port (src/users/users.ports.ts): booking
 * stats and history for profile/admin views, and cancelling a closed
 * account's pending bookings in the closure's transaction.
 */
@Injectable()
export class UserBookingsService implements UserBookingsPort {
  private readonly logger = new Logger(UserBookingsService.name);

  constructor(
    private readonly bookings: BookingsRepository,
    private readonly cancellation: BookingCancellationService,
  ) {}

  hasSeatInUse(manager: EntityManager, userId: string): Promise<boolean> {
    return this.bookings.hasSeatInUse(manager, userId);
  }

  async cancelAllPending(
    manager: EntityManager,
    userId: string,
    actorId: string,
    now: Date,
  ): Promise<number> {
    const pending = await this.bookings.lockPendingForUser(manager, userId);
    if (pending.length === 0) return 0;
    // Existing contract values only: the owner closing their own account is a
    // user cancellation, an admin closing it an admin one.
    const byOwner = actorId === userId;
    await this.cancellation.cancel(
      manager,
      pending,
      { userId: actorId },
      'Account closed',
      now,
      byOwner ? 'USER_CANCELLED' : 'ADMIN_CANCELLED',
      { subReason: 'ACCOUNT_CLOSED' },
    );
    this.logger.log(
      `Bookings cancelled by account closure: user=${userId} count=${pending.length}`,
    );
    return pending.length;
  }

  summary(userId: string): Promise<UserBookingSummary> {
    return this.bookings.summaryForUser(userId, new Date());
  }

  async activity(
    userId: string,
    page: number,
    limit: number,
  ): Promise<{ items: UserActivityItem[]; total: number }> {
    const { items, total } = await this.bookings.eventsForUser(userId, page, limit);
    return {
      total,
      items: items.map((e) => {
        const actor: ActivityActor = e.bySystem
          ? 'SYSTEM'
          : e.byClient
            ? 'API_CLIENT'
            : e.actorUserId === userId
              ? 'SELF'
              : 'OTHER_USER';
        return {
          id: e.id,
          bookingId: e.bookingId,
          type: e.type,
          actor,
          ownBooking: e.bookingUserId === userId,
          placeName: e.placeName,
          seatLabel: e.seatLabel,
          createdAt: e.createdAt,
        };
      }),
    };
  }
}
