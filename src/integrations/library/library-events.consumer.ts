import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { integrationsConfig } from '../../configuration/integrations.config';
import type { ConsumerRoute } from '../../messaging/consumers/consumer-route';
import { ConsumerRunner } from '../../messaging/consumers/consumer-runner';
import {
  LIBRARY_DLX_KEY,
  LIBRARY_EXCHANGE,
  LIBRARY_QUEUE,
  LIBRARY_SYSTEM,
  LibraryRoutingKey,
} from './library.constants';
import { LibraryPlaceSyncService } from './library-place-sync.service';

/**
 * Consumes `library.events` (LMS) on `space-booking.library-events`.
 * Bound keys (one by one, contract section 2): place.created, place.updated.
 * member.standing_changed (phase 3) gets a handler and binding when built.
 */
@Injectable()
export class LibraryEventsConsumer implements OnApplicationBootstrap {
  private readonly logger = new Logger(LibraryEventsConsumer.name);

  constructor(
    private readonly runner: ConsumerRunner,
    private readonly sync: LibraryPlaceSyncService,
    @Inject(integrationsConfig.KEY)
    private readonly config: ConfigType<typeof integrationsConfig>,
  ) {}

  readonly route: ConsumerRoute = {
    queue: LIBRARY_QUEUE,
    dlxKey: LIBRARY_DLX_KEY,
    producer: LIBRARY_SYSTEM,
    exchange: LIBRARY_EXCHANGE,
    handlers: {
      // Both carry the full snapshot and are applied the same way.
      [LibraryRoutingKey.PLACE_CREATED]: async (manager, envelope) => {
        await this.sync.apply(manager, envelope);
      },
      [LibraryRoutingKey.PLACE_UPDATED]: async (manager, envelope) => {
        await this.sync.apply(manager, envelope);
      },
    },
  };

  onApplicationBootstrap(): void {
    if (!this.config.libraryEnabled) {
      this.logger.log('LIBRARY_INTEGRATION_ENABLED is not true: LMS consumer is off');
      return;
    }
    this.runner.start(this.route);
  }
}
