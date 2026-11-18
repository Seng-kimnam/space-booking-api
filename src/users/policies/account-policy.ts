import { UserRole } from '../../common/enums/index';
import type { User } from '../entities/user.entity';

/**
 * Who may act on whom (roles from the DB, not the possibly stale JWT):
 * ADMIN -> USERs; SUPER_ADMIN -> USERs and ADMINs; never a SUPER_ADMIN,
 * yourself, or as a suspended/closed actor.
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
