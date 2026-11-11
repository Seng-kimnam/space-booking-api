import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExternalIdentity } from './entities/external-identity.entity';
import { ExternalLinkRequest } from './entities/external-link-request.entity';
import { ExternalIdentitiesService } from './external-identities.service';

/**
 * external_identities + external_link_requests. A low layer (only entities of
 * users and api_clients), so bookings (eligibility, member ids in events) and
 * integrations (link flow, standing) can both use it.
 */
@Module({
  imports: [TypeOrmModule.forFeature([ExternalIdentity, ExternalLinkRequest])],
  providers: [ExternalIdentitiesService],
  exports: [ExternalIdentitiesService],
})
export class ExternalIdentitiesModule {}
