import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { AdminPlacesController } from './controllers/admin-places.controller';
import { PlacesController } from './controllers/places.controller';
import { BookingPolicy } from './entities/booking-policy.entity';
import { PlaceClosure } from './entities/place-closure.entity';
import { PlaceOpeningHour } from './entities/place-opening-hour.entity';
import { Place } from './entities/place.entity';
import { BookingPoliciesService } from './services/booking-policies.service';
import { OpeningHoursService } from './services/opening-hours.service';
import { PlacesService } from './services/places.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Place,
      PlaceOpeningHour,
      PlaceClosure,
      BookingPolicy,
    ]),
    AuthModule,
  ],
  controllers: [PlacesController, AdminPlacesController],
  providers: [PlacesService, OpeningHoursService, BookingPoliciesService],
  exports: [PlacesService, OpeningHoursService, BookingPoliciesService],
})
export class PlacesModule {}
