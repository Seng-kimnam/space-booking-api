import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

type AuthenticatedRequest = Request & {
  user?: Record<string, unknown>;
};

@Injectable()
export class AuthGuard implements CanActivate {
  // debug, not warn: expired access tokens are routine (15 min lifetime), so
  // these would flood the log. Never logs the token or the Authorization header.
  private readonly logger = new Logger(AuthGuard.name);

  constructor(private jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractToken(request);
    if (!token) {
      this.logger.debug(`401 ${describe(request)}: no bearer token`);
      throw new UnauthorizedException('No token provided');
    }
    try {
      const payload = await this.jwtService.verifyAsync(token);
      request['user'] = payload;
    } catch (err) {
      // TokenExpiredError / JsonWebTokenError / NotBeforeError: name only.
      const reason = err instanceof Error ? err.name : 'invalid token';
      this.logger.debug(`401 ${describe(request)}: ${reason}`);
      throw new UnauthorizedException();
    }
    return true;
  }

  private extractToken(request: Request): string | undefined {
    const authorization = request.headers.authorization?.trim();
    if (!authorization) {
      return undefined;
    }

    const [type, token, ...extraParts] = authorization.split(/\s+/);
    return type?.toLowerCase() === 'bearer' && token && extraParts.length === 0
      ? token
      : undefined;
  }
}

/** "GET /api/v1/bookings": path only, so query strings never reach the log. */
function describe(request: Request): string {
  return `${request.method} ${request.path}`;
}
