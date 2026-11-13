import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { AdminApiClientsController } from './controllers/admin-api-clients.controller';
import { ApiClient } from './entities/api-client.entity';
import { ApiKeyGuard } from './guards/api-key.guard';
import { ApiClientsService } from './services/api-clients.service';

/**
 * Integrating systems calling our REST API (docs/integration/service-authentication.md
 * section 2.1). Modules with @ClientSecured routes import this one for ApiKeyGuard.
 * AuthModule: JWT guard of the admin endpoints.
 */
@Module({
  imports: [TypeOrmModule.forFeature([ApiClient]), AuthModule],
  controllers: [AdminApiClientsController],
  providers: [ApiClientsService, ApiKeyGuard],
  exports: [ApiClientsService, ApiKeyGuard],
})
export class ApiClientsModule {}
