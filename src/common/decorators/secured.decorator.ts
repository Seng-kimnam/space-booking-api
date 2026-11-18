import { applyDecorators, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../auth/guards/auth.guard';
import { Roles } from '../../auth/decorators/role.decorator';
import { RolesGuard } from '../guards/roles.guard';
import { UserRole } from '../enums';

/**
 * The one way to protect a route: JWT auth (AuthGuard), then the role check
 * (RolesGuard; SUPER_ADMIN also passes ADMIN routes). `@Secured()` with no
 * roles = any signed-in user. A method-level @Roles(...) overrides the
 * class-level roles. DTO validation is the global ValidationPipe (main.ts).
 */
export const Secured = (...roles: UserRole[]) =>
  applyDecorators(UseGuards(AuthGuard, RolesGuard), Roles(...roles));
