// roles.interceptor.ts
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { UserRole } from '../users/entities/user.entity';

@Injectable()
export class RolesInterceptor implements NestInterceptor {
  constructor(private reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    // 1. Retrieve the required roles attached to the handler or controller
    const requiredRoles = this.reflector.getAllAndOverride<string[]>('roles', [
      context.getHandler(),
      context.getClass(),
    ]);

    // If no roles are specified, bypass and allow request execution
    if (!requiredRoles) {
      return next.handle();
    }

    // 2. Extract the user from the incoming HTTP request context
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // 3. Validate user presence and evaluate authorization roles
    if (!user || !user.role) {
      throw new ForbiddenException(
        'Access denied: User context missing or unauthorized.',
      );
    }

    const hasRole = () =>
      requiredRoles.includes(user.role as UserRole) ||
      (user.role === UserRole.SUPER_ADMIN &&
        requiredRoles.includes(UserRole.ADMIN));
    if (!hasRole()) {
      throw new ForbiddenException('Access denied: Insufficient privileges.');
    }

    // 4. Continue execution flow to the route handler
    return next.handle();
  }
}
