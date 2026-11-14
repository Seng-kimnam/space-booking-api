import { UserRole } from '../common/enums';
import type { User } from './entities/user.entity';

/**
 * Who may act on whom in /admin/users (docs/auth.md M3). Roles are read from
 * the database, not the JWT, which may be up to one token lifetime stale.
 * - ADMIN: USER accounts only.
 * - SUPER_ADMIN: USER and ADMIN accounts.
 * - Nobody: a SUPER_ADMIN, their own account, or as a suspended/closed actor.
 */
export function canManage(actor: User | null, target: User): boolean {
  if (!actor || !actor.isActive || actor.deletedAt || actor.id === target.id) return false;
  const actorRole = actor.role.name as UserRole;
  const targetRole = target.role.name as UserRole;
  if (targetRole === UserRole.SUPER_ADMIN) return false;
  return (
    actorRole === UserRole.SUPER_ADMIN ||
    (actorRole === UserRole.ADMIN && targetRole === UserRole.USER)
  );
}

export function isSuperAdmin(actor: User | null): boolean {
  return (
    !!actor && actor.isActive && !actor.deletedAt && actor.role.name === UserRole.SUPER_ADMIN
  );
}
