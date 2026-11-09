import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { UserRole } from '../enums';
import type { AuthUser } from '../types/auth-user';

/**
 * The authenticated user as { id, role }. AuthGuard puts the raw JWT payload
 * ({ sub, email, role }) on request.user; this maps `sub` to `id` in one place.
 */
export const CurrentAuthUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const user = ctx.switchToHttp().getRequest<{ user?: { sub?: string; role?: string } }>().user;
    if (!user?.sub || !user.role) throw new UnauthorizedException();
    return { id: user.sub, role: user.role as UserRole };
  },
);
