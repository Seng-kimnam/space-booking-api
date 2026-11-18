import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

/** Same shape as InboxMessage in telegram.ports.ts (messaging has no domain imports). */
export interface InboxEntry {
  source: string;
  messageId: string;
  eventType: string;
  /** Stored in inbox_events. Must not contain codes or tokens; keep it small. */
  payload: Record<string, unknown>;
}

/**
 * INBOX port (AGENTS.md section 6.12). The inbox row and the handler run in ONE
 * transaction:
 * - duplicate (source, message_id) already committed -> handler not run, false;
 * - handler throws -> everything rolls back, including the inbox row, so a
 *   redelivery is processed again (the interim version dropped it);
 * - a concurrent duplicate waits on the unique index, then sees the row.
 * Handlers that should be atomic with the inbox row write through `manager`.
 */
@Injectable()
export class InboxService {
  constructor(private readonly dataSource: DataSource) {}

  handleOnce(
    message: InboxEntry,
    handler: (manager: EntityManager) => Promise<void>,
  ): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const inserted: { id: string }[] = await manager.query(
        `INSERT INTO inbox_events (source, message_id, event_type, payload, processed_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (source, message_id) DO NOTHING
         RETURNING id`,
        [message.source, message.messageId, message.eventType, message.payload],
      );
      if (inserted.length === 0) return false;
      await handler(manager);
      return true;
    });
  }
}
