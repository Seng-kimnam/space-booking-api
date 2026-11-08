import { applyDecorators, UseGuards, UseInterceptors, UsePipes, ValidationPipe } from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard';
import { Roles } from '../../auth/role.decorator';
import { RolesInterceptor } from '../../auth/roles.interceptor';
import { UserRole } from '../../users/entities/user.entity';

/**
 * JWT auth + role check + DTO validation in one decorator, the same stack the
 * seats controllers apply by hand. Remove once the app has global guards/pipes.
 * A method-level @Roles(...) still overrides the class-level roles.
 */
export const Secured = (...roles: UserRole[]) =>
  applyDecorators(
    UseGuards(AuthGuard),
    UseInterceptors(RolesInterceptor),
    Roles(...roles),
    UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })),
  );
