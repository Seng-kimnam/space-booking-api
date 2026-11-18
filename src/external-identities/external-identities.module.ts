import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExternalIdentity } from './entities/external-identity.entity';
import { ExternalLinkRequest } from './entities/external-link-request.entity';
import { ExternalIdentitiesService } from './external-identities.service';

/** Partner account links. Kept low-level so both bookings and integrations can use it. */
@Module({
  imports: [TypeOrmModule.forFeature([ExternalIdentity, ExternalLinkRequest])],
  providers: [ExternalIdentitiesService],
  exports: [ExternalIdentitiesService],
})
export class ExternalIdentitiesModule {}
