import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentAuthUser } from '../common/decorators/current-auth-user.decorator';
import { Secured } from '../common/decorators/secured.decorator';
import { UserRole } from '../common/enums';
import type { AuthUser } from '../common/types/auth-user';
import { AccountStatusService } from './account-status.service';
import { ListUsersQueryDto, UserPageResponseDto, UserResponseDto } from './dto/user.dto';
import { UsersService } from './users.service';

/**
 * Account management for admins (docs/api-endpoints.md 8e-8h). RolesInterceptor
 * lets SUPER_ADMIN through ADMIN routes; which targets each role may suspend
 * or reactivate is decided in AccountStatusService.
 */
@ApiTags('Users')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@ApiForbiddenResponse({
  description: 'Not an ADMIN/SUPER_ADMIN, or not allowed to act on this account',
})
@Secured(UserRole.ADMIN)
@Controller('admin/users')
export class AdminUsersController {
  constructor(
    private readonly users: UsersService,
    private readonly accounts: AccountStatusService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List accounts (filter by role, status, name/email)' })
  @ApiOkResponse({ type: UserPageResponseDto })
  list(@Query() query: ListUsersQueryDto): Promise<UserPageResponseDto> {
    return this.users.list(query);
  }

  @Get(':userId')
  @ApiOperation({ summary: 'Get one account' })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiNotFoundResponse()
  get(@Param('userId', ParseUUIDPipe) userId: string): Promise<UserResponseDto> {
    return this.users.get(userId);
  }

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
