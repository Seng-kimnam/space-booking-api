import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../../common/enums';
import { ROLES_KEY } from '../../common/guards/roles.guard';

/**
 * Roles allowed on a route, checked by RolesGuard. Usually set through
 * @Secured(...roles); a method-level @Roles(...) overrides the class-level one.
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
