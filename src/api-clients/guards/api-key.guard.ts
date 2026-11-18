import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { API_KEY_HEADER } from '../api-key';
import type { ApiClientScope } from '../api-key';
import { CLIENT_SCOPES_KEY } from '../api-clients.constants';
import { ApiClientsService } from '../services/api-clients.service';
import type { ApiClientRequest } from '../types';

/**
 * Authenticates an integrating system by its X-API-Key and checks the route's
 * scopes (docs/integration/service-authentication.md section 2.1).
 * 401: missing, malformed, unknown, wrong or inactive key (one message for all).
 * 403: valid key without a required scope. Never logs the header.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);

  constructor(
    private readonly clients: ApiClientsService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ApiClientRequest>();
    const client = await this.clients.authenticate(request.headers[API_KEY_HEADER]);
    if (!client) {
      this.logger.debug(`401 ${request.method} ${request.path}: invalid API key`);
      throw new UnauthorizedException('Invalid API key');
    }
    const required =
      this.reflector.getAllAndOverride<ApiClientScope[]>(CLIENT_SCOPES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    const missing = required.filter((s) => !client.scopes.includes(s));
    if (missing.length > 0) {
      this.logger.warn(`403 ${request.method} ${request.path}: client=${client.id} missing ${missing.join(',')}`);
      throw new ForbiddenException(`Missing scope: ${missing.join(', ')}`);
    }
    request.apiClient = client;
    return true;
  }
}
