import {
  applyDecorators,
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiSecurity,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { API_KEY_SECURITY, CLIENT_SCOPES_KEY } from '../api-clients.constants';
import type { ApiClientScope } from '../api-key';
import { ApiKeyGuard } from '../guards/api-key.guard';
import type { ApiClientRequest, AuthApiClient } from '../types';


/**
 * Route for integrating systems only: X-API-Key with all of `scopes`. Users'
 * JWTs are not accepted here (docs/integration/service-authentication.md §2.1).
 * The module using it must import ApiClientsModule (for ApiKeyGuard).
 */
export const ClientSecured = (...scopes: ApiClientScope[]) =>
  applyDecorators(
    SetMetadata(CLIENT_SCOPES_KEY, scopes),
    UseGuards(ApiKeyGuard),
    ApiSecurity(API_KEY_SECURITY),
    ApiUnauthorizedResponse({ description: 'Missing or invalid X-API-Key' }),
    ApiForbiddenResponse({ description: `Requires scope(s): ${scopes.join(', ')}` }),
    UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })),
  );

/** The authenticated system on a @ClientSecured route. */
export const CurrentApiClient = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthApiClient => {
    const client = ctx.switchToHttp().getRequest<ApiClientRequest>().apiClient;
    // ApiKeyGuard always sets it; reaching here without it is a wiring bug.
    if (!client) throw new Error('CurrentApiClient used without @ClientSecured');
    return client;
  },
);
