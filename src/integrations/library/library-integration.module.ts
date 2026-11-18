import { Module } from '@nestjs/common';
import { ApiClientsModule } from '../../api-clients/api-clients.module';
import { AuthModule } from '../../auth/auth.module';
import { BookingsModule } from '../../bookings/bookings.module';
import { ExternalIdentitiesModule } from '../../external-identities/external-identities.module';
import { PlacesModule } from '../../places/places.module';
import { LmsClient } from './clients/lms.client';
import { LibraryEventsConsumer } from './consumers/library-events.consumer';
import { AdminLibraryPlacesController } from './controllers/admin-library-places.controller';
import { LibraryLinksClientController } from './controllers/library-links.controller';
import { LibraryMyLinkController } from './controllers/library-my-link.controller';
import { LibraryPlacesController } from './controllers/library-places.controller';
import { PlaceRepairJob } from './jobs/place-repair.job';
import { LibraryLinksService } from './services/library-links.service';
import { LibraryPlaceRepairService } from './services/library-place-repair.service';
import { LibraryPlaceSyncService } from './services/library-place-sync.service';

/**
 * LMS (LibraFlow) integration: place sync over RabbitMQ with an HTTP repair
 * job, and member account linking. It sits above places and bookings because
 * one snapshot touches all of them.
 */
@Module({
  // AuthModule provides the JwtService that @Secured needs.
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
