import {
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthGuard } from './auth.guard';
import { Roles } from './role.decorator';
import { RolesInterceptor } from './roles.interceptor';
import { AccountStatusService } from './account-status.service';
import { CurrentAuthUser } from '../common/decorators/current-auth-user.decorator';
import { UserRole } from '../common/enums';
import type { AuthUser } from '../common/types/auth-user';

// docs/api-endpoints.md 8e/8f. RolesInterceptor lets SUPER_ADMIN through ADMIN
// routes; which targets each role may act on is decided in AccountStatusService.
@ApiTags('Admin users')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@ApiForbiddenResponse({
  description: 'Not an ADMIN/SUPER_ADMIN, or not allowed to act on this account',
})
@UseGuards(AuthGuard)
@UseInterceptors(RolesInterceptor)
@Roles(UserRole.ADMIN)
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly accounts: AccountStatusService) {}

  @Post(':userId/suspend')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Suspend an account: login and refresh refused, sessions revoked',
  })
  @ApiNoContentResponse()
  @ApiNotFoundResponse()
  suspend(
    @CurrentAuthUser() actor: AuthUser,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    return this.accounts.suspend(actor.id, userId);
  }

  @Post(':userId/reactivate')
  @HttpCode(204)
  @ApiOperation({ summary: 'Reactivate a suspended account' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse()
  reactivate(
    @CurrentAuthUser() actor: AuthUser,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    return this.accounts.reactivate(actor.id, userId);
  }
}
