import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { UserRole } from '../enums';

/** Metadata key written by @Roles(...) (src/auth/decorators/role.decorator.ts). */
export const ROLES_KEY = 'roles';

/** SUPER_ADMIN may do everything an ADMIN may (AGENTS.md section 1). */
export function hasRequiredRole(role: string, required: readonly string[]): boolean {
  return (
    required.includes(role) ||
    (role === UserRole.SUPER_ADMIN && required.includes(UserRole.ADMIN))
  );
}

type RequestWithUser = Request & { user?: { role?: unknown; sub?: unknown } };

/**
 * The one role check. Allows the request only if the authenticated user's
 * role is one of the roles set with @Roles(...) on the handler or controller
 * (handler wins); SUPER_ADMIN also passes ADMIN routes. Must run after
 * AuthGuard, which puts the JWT payload on request.user. Apply both with
 * @Secured(...roles) (src/common/decorators/secured.decorator.ts).
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
    if (typeof role !== 'string' || !hasRequiredRole(role, required)) {
      this.logger.warn(
        `403 ${request.method} ${request.path}: user=${String(request.user?.sub ?? 'unknown')} ` +
          `role=${typeof role === 'string' ? role : 'none'} required=${required.join('|')}`,
      );
      throw new ForbiddenException('Access denied: insufficient role');
    }
    return true;
  }
}
