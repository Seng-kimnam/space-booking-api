import { Module } from '@nestjs/common';
import { ApiClientsModule } from '../../api-clients/api-clients.module';
import { AuthModule } from '../../auth/auth.module';
import { BookingsModule } from '../../bookings/bookings.module';
import { ExternalIdentitiesModule } from '../../external-identities/external-identities.module';
import { PlacesModule } from '../../places/places.module';
import { LibraryEventsConsumer } from './library-events.consumer';
import { LibraryPlaceRepairService } from './library-place-repair.service';
import { LibraryPlaceSyncService } from './library-place-sync.service';
import { LibraryLinksClientController, LibraryMyLinkController } from './library-links.controller';
import { LibraryLinksService } from './library-links.service';
import {
  AdminLibraryPlacesController,
  LibraryPlacesController,
} from './library-places.controller';
import { LmsClient } from './lms.client';
import { PlaceRepairJob } from './place-repair.job';

/**
 * LMS (LibraFlow) integration (docs/integration/lms-message-contract.md):
 * - RabbitMQ: consumes place snapshots, replies place.sync_* (LibraryEventsConsumer);
 * - HTTP out: LmsClient + hourly PlaceRepairJob (GET /external/places/:id/snapshot);
 * - account linking: link-requests / links (LMS, API key), my-link (user), identity.* events,
 *   member.standing_changed consumer;
 * - HTTP in: GET /integrations/library/places/:placeId for LMS (API key, places:read),
 *   POST /admin/integrations/library/places/:placeId/resync for our admins.
 * Sits above places, areas, seats and bookings, because a snapshot touches all
 * of them (docs/integration/implementation-plan.md section 3.1). MessagingModule
 * (global) provides the outbox, inbox, schemas and consumer runner.
 */
@Module({
  // AuthModule: JwtService for @Secured (admin resync, user my-link routes).
  imports: [AuthModule, PlacesModule, BookingsModule, ApiClientsModule, ExternalIdentitiesModule],
  controllers: [
    LibraryPlacesController,
    AdminLibraryPlacesController,
    LibraryLinksClientController,
    LibraryMyLinkController,
  ],
  providers: [
    LibraryPlaceSyncService,
    LibraryEventsConsumer,
    LmsClient,
    LibraryPlaceRepairService,
    PlaceRepairJob,
    LibraryLinksService,
  ],
  exports: [LibraryPlaceSyncService],
})
export class LibraryIntegrationModule {}
