import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { integrationsConfig } from '../../../configuration/integrations.config';
import type { ConsumerRoute, MessageHandler } from '../../../messaging/consumers/consumer-route';
import { ConsumerRunner } from '../../../messaging/consumers/consumer-runner';
import { MessageType } from '../../../messaging/contract/schemas';
import { LIBRARY_DLX_KEY, LIBRARY_EXCHANGE, LIBRARY_QUEUE, LIBRARY_SYSTEM } from '../library.constants';
import { LibraryLinksService } from '../services/library-links.service';
import { LibraryPlaceSyncService } from '../services/library-place-sync.service';

/** Consumes LMS events from `library.events` into our `space-booking.library-events` queue. */
@Injectable()
export class LibraryEventsConsumer implements OnApplicationBootstrap {
  private readonly logger = new Logger(LibraryEventsConsumer.name);

  constructor(
    private readonly runner: ConsumerRunner,
    private readonly sync: LibraryPlaceSyncService,
    private readonly links: LibraryLinksService,
    @Inject(integrationsConfig.KEY)
    private readonly config: ConfigType<typeof integrationsConfig>,
  ) {}

  // place.created and place.updated both carry the full snapshot.
  private readonly applySnapshot: MessageHandler = async (manager, envelope) => {
    await this.sync.apply(manager, envelope);
  };

  readonly route: ConsumerRoute = {
    queue: LIBRARY_QUEUE,
    dlxKey: LIBRARY_DLX_KEY,
    producer: LIBRARY_SYSTEM,
    exchange: LIBRARY_EXCHANGE,
    handlers: {
      [MessageType.PLACE_CREATED]: this.applySnapshot,
      [MessageType.PLACE_UPDATED]: this.applySnapshot,
      [MessageType.MEMBER_STANDING_CHANGED]: (manager, envelope) => this.links.applyStanding(manager, envelope),
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
