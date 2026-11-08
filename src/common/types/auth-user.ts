import { UserRole } from '../enums';

/**
 * What the global JWT guard must put on `request.user` (read with @CurrentUser()).
 * Contract with the auth module: the access token carries the user's role, and
 * the strategy maps `sub` -> `id`. Never take these values from the request body.
 */
export interface AuthUser {
  id: string;
  role: UserRole;
}
