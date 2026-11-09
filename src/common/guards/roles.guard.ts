import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';

/** Metadata key written by @Roles(...) (src/auth/role.decorator.ts). */
export const ROLES_KEY = 'roles';

type RequestWithUser = Request & { user?: { role?: unknown } };

/**
 * Allows the request only if the authenticated user's role is one of the
 * roles set with @Roles(...) on the handler or controller (handler wins).
 * Must run after AuthGuard, which puts the JWT payload on request.user:
 *   @UseGuards(AuthGuard, RolesGuard)
 * No @Roles(...) = any authenticated user.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) return true;

    const role = context.switchToHttp().getRequest<RequestWithUser>()
      .user?.role;
    if (typeof role !== 'string' || !required.includes(role)) {
      throw new ForbiddenException('Access denied: insufficient role');
    }
    return true;
  }
}
