import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import type { IncomingEnvelope } from '../../../messaging/consumers/consumer-route';
import { MessageType } from '../../../messaging/contract/schemas';
import { Place } from '../../../places/entities/place.entity';
import { ServiceHttpError } from '../../http/service-http.client';
import { LmsClient } from '../clients/lms.client';
import { LIBRARY_SYSTEM } from '../library.constants';
import { LibraryPlaceSyncService, SyncOutcome } from './library-place-sync.service';

/**
 * Heals places after a lost or dead-lettered message: pulls the snapshot over
 * HTTP and applies it like a place.updated. Already up to date = no-op.
 */
@Injectable()
export class LibraryPlaceRepairService {
  private readonly logger = new Logger(LibraryPlaceRepairService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly lms: LmsClient,
    private readonly sync: LibraryPlaceSyncService,
  ) {}

  isEnabled(): boolean {
    return this.lms.isConfigured();
  }

  /** Re-syncs the least recently updated LMS places. Returns how many were checked. */
  async repairBatch(limit: number): Promise<number> {
    const places = await this.dataSource.getRepository(Place).find({
      where: { externalSystem: LIBRARY_SYSTEM },
      order: { updatedAt: 'ASC' },
      take: limit,
      select: { id: true, externalId: true },
    });
    for (const place of places) {
      try {
        await this.resyncLmsPlace(place.externalId!);
      } catch (err) {
        // One bad place must not stop the others, but if LMS is down, stop this run.
        if (err instanceof ServiceHttpError && err.status === null) {
          this.logger.warn(`LMS unreachable, place repair stopped: ${err.message}`);
          break;
        }
        this.logger.warn(`Place repair failed for lms place ${place.externalId}: ${(err as Error).message}`);
      }
    }
    return places.length;
  }

  /** Fetches one LMS place and applies it. 404 if LMS doesn't know it. */
  async resyncLmsPlace(lmsPlaceId: string): Promise<SyncOutcome> {
    if (!this.isEnabled()) throw new ServiceUnavailableException('LMS_BASE_URL is not configured');
    const snapshot = await this.lms.getPlaceSnapshot(lmsPlaceId);
    if (!snapshot) throw new NotFoundException(`LMS has no place ${lmsPlaceId}`);
    const envelope: IncomingEnvelope = {
      // Not a broker message, so no inbox row. The id only names a possible sync_rejected row.
      id: randomUUID(),
      type: MessageType.PLACE_UPDATED,
      version: 1,
      source: LIBRARY_SYSTEM,
      occurredAt: new Date().toISOString(),
      correlationId: null,
      subject: { type: 'place', id: lmsPlaceId },
      data: snapshot as unknown as Record<string, unknown>,
    };
    const outcome = await this.dataSource.transaction((m) => this.sync.apply(m, envelope));
    if (outcome.result !== 'stale')
      this.logger.log(`Place repair: lms place ${lmsPlaceId} revision ${snapshot.revision} ${outcome.result}`);
    return outcome;
  }
}
