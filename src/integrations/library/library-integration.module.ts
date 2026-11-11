import { Module } from '@nestjs/common';
import { ApiClientsModule } from '../../api-clients/api-clients.module';
import { BookingsModule } from '../../bookings/bookings.module';
import { PlacesModule } from '../../places/places.module';
import { LibraryEventsConsumer } from './library-events.consumer';
import { LibraryPlaceRepairService } from './library-place-repair.service';
import { LibraryPlaceSyncService } from './library-place-sync.service';
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
 * - HTTP in: GET /integrations/library/places/:placeId for LMS (API key, places:read),
 *   POST /admin/integrations/library/places/:placeId/resync for our admins.
 * Sits above places, areas, seats and bookings, because a snapshot touches all
 * of them (docs/integration/implementation-plan.md section 3.1). MessagingModule
 * (global) provides the outbox, inbox, schemas and consumer runner.
 */
@Module({
  imports: [PlacesModule, BookingsModule, ApiClientsModule],
  controllers: [LibraryPlacesController, AdminLibraryPlacesController],
  providers: [
    LibraryPlaceSyncService,
    LibraryEventsConsumer,
    LmsClient,
    LibraryPlaceRepairService,
    PlaceRepairJob,
  ],
  exports: [LibraryPlaceSyncService],
})
export class LibraryIntegrationModule {}
