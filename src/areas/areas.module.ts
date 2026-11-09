import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { PlacesModule } from '../places/places.module';
import { AdminAreasController } from './controllers/admin-areas.controller';
import { AreasController } from './controllers/areas.controller';
import { Area } from './entities/area.entity';
import { AreasService } from './services/areas.service';

@Module({
  imports: [TypeOrmModule.forFeature([Area]), PlacesModule, AuthModule],
  controllers: [AreasController, AdminAreasController],
  providers: [AreasService],
  exports: [AreasService],
})
export class AreasModule {}
