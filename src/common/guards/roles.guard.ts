import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';

/** Metadata key written by @Roles(...) (src/auth/role.decorator.ts). */
export const ROLES_KEY = 'roles';

type RequestWithUser = Request & { user?: { role?: unknown; sub?: unknown } };

/**
 * Allows the request only if the authenticated user's role is one of the
 * roles set with @Roles(...) on the handler or controller (handler wins).
 * Must run after AuthGuard, which puts the JWT payload on request.user:
 *   @UseGuards(AuthGuard, RolesGuard)
 * No @Roles(...) = any authenticated user.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  // warn: a 403 means a valid user tried something their role doesn't allow.
  private readonly logger = new Logger(RolesGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) return true;

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const role = request.user?.role;
    if (typeof role !== 'string' || !required.includes(role)) {
      this.logger.warn(
        `403 ${request.method} ${request.path}: user=${String(request.user?.sub ?? 'unknown')} ` +
          `role=${typeof role === 'string' ? role : 'none'} required=${required.join('|')}`,
      );
      throw new ForbiddenException('Access denied: insufficient role');
    }
    return true;
  }
}
