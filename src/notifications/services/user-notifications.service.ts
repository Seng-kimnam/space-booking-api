import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { UserNotificationItem, UserNotificationsPort } from '../../users/users.ports';
import { Notification } from '../entities/notification.entity';

/**
 * The users module's USER_NOTIFICATIONS port: a user's alert history, newest
 * first (index notifications_user_created_idx). Never returns the payload.
 */
@Injectable()
export class UserNotificationsService implements UserNotificationsPort {
  constructor(
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
  ) {}

  async list(
    userId: string,
    page: number,
    limit: number,
    withErrors: boolean,
  ): Promise<{ items: UserNotificationItem[]; total: number }> {
    const [rows, total] = await this.notifications.findAndCount({
      where: { userId },
      order: { createdAt: 'DESC', id: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return {
      total,
      items: rows.map((n) => ({
        id: n.id,
        type: n.type,
        channel: n.channel,
        status: n.status,
        bookingId: n.bookingId,
        scheduledAt: n.scheduledAt,
        sentAt: n.sentAt,
        attempts: n.attempts,
        ...(withErrors ? { lastError: n.lastError } : {}),
        createdAt: n.createdAt,
      })),
    };
  }
}
