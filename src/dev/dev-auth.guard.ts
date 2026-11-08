import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { DataSource } from 'typeorm';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { UserRole } from '../common/enums';
import type { AuthUser } from '../common/types/auth-user';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * TEMPORARY development-only login, until the auth module ships its global JWT
 * guard. Send `Authorization: Bearer <user id>` (a users.id, e.g. from the demo
 * seed); the user's role is read from the database, never from the request.
 * Also enforces @Public() and @Roles(...). DevModule refuses to start in production.
 */
@Injectable()
export class DevAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly dataSource: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;
    const roles = this.reflector.getAllAndOverride<string[] | undefined>('roles', targets);
    // Only guard routes that declare @Roles (ours), so teammates' routes behave
    // exactly as before this temporary guard existed.
    if (!roles?.length) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    if (type !== 'Bearer' || !token || !UUID.test(token)) {
      throw new UnauthorizedException('Dev login: send Authorization: Bearer <user id>');
    }

    const rows: { id: string; role: UserRole }[] = await this.dataSource.query(
      'SELECT id, role FROM users WHERE id = $1 AND is_active AND deleted_at IS NULL',
      [token],
    );
    if (rows.length === 0) throw new UnauthorizedException();
    request.user = { id: rows[0].id, role: rows[0].role };

    if (!roles.includes(request.user.role)) {
      throw new ForbiddenException('Insufficient role');
    }
    return true;
  }
}
