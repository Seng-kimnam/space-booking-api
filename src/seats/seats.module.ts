import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Seat } from './entities/seat.entity';
import { AuthModule } from '../auth/auth.module';
import { PlacesModule } from '../places/places.module';
import { AdminSeatsController } from './controllers/admin-seats.controller';
import { SeatsController } from './controllers/seats.controller';
import { SeatsService } from './services/seats.service';

@Module({
  imports: [TypeOrmModule.forFeature([Seat]), AuthModule, PlacesModule],
  controllers: [SeatsController, AdminSeatsController],
  providers: [SeatsService],
  exports: [SeatsService],
})
export class SeatsModule {}
