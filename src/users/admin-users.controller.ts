import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
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
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { UserRole } from '../common/enums';
import type { AuthUser } from '../common/types/auth-user';
import { AccountStatusService } from './account-status.service';
import { AdminAccountsService } from './admin-accounts.service';
import {
  ActivityPageResponseDto,
  AdminUpdateUserDto,
  ChangeRoleDto,
  CreateUserDto,
  ListUsersQueryDto,
  NotificationPageResponseDto,
  SessionResponseDto,
  UserDetailResponseDto,
  UserPageResponseDto,
  UserResponseDto,
  UserStatsResponseDto,
} from './dto/user.dto';
import { UsersService } from './users.service';

/**
 * Account management for admins (docs/api-endpoints.md 8e-8p). RolesInterceptor
 * lets SUPER_ADMIN through ADMIN routes; which accounts each role may change
 * is decided in account-policy.ts (ADMIN: USERs; SUPER_ADMIN: USERs and ADMINs;
 * nobody: a SUPER_ADMIN or themselves). Reads are open to every admin.
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
    private readonly admin: AdminAccountsService,
  ) {}

  // Declared before ':userId' so "stats" isn't parsed as an id.
  @Get('stats')
  @ApiOperation({ summary: 'Account statistics for the dashboard' })
  @ApiOkResponse({ type: UserStatsResponseDto })
  stats(): Promise<UserStatsResponseDto> {
    return this.users.stats();
  }

  @Get()
  @ApiOperation({ summary: 'List accounts (filter by role, status, name/email)' })
  @ApiOkResponse({ type: UserPageResponseDto })
  list(@Query() query: ListUsersQueryDto): Promise<UserPageResponseDto> {
    return this.users.list(query);
  }

  @Post()
  @ApiOperation({
    summary: 'Create an account; the user gets a code to set their password',
    description: 'Email is marked verified. ADMIN accounts only by a SUPER_ADMIN.',
  })
  @ApiCreatedResponse({ type: UserResponseDto })
  @ApiConflictResponse({ description: 'Email already in use' })
  create(
    @CurrentAuthUser() actor: AuthUser,
    @Body() dto: CreateUserDto,
  ): Promise<UserResponseDto> {
    return this.admin.create(actor.id, dto);
  }

  @Get(':userId')
  @ApiOperation({ summary: 'One account with sign-in methods, links and booking stats' })
  @ApiOkResponse({ type: UserDetailResponseDto })
  @ApiNotFoundResponse()
  get(@Param('userId', ParseUUIDPipe) userId: string): Promise<UserDetailResponseDto> {
    return this.users.getDetail(userId);
  }

  @Patch(':userId')
  @ApiOperation({ summary: 'Edit name/avatar or reset the no-show count' })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'Account is closed' })
  update(
    @CurrentAuthUser() actor: AuthUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: AdminUpdateUserDto,
  ): Promise<UserResponseDto> {
    return this.admin.update(actor.id, userId, dto);
  }

  @Patch(':userId/role')
  @ApiOperation({
    summary: 'Change role (SUPER_ADMIN only); signs the user out everywhere',
  })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiNotFoundResponse()
  changeRole(
    @CurrentAuthUser() actor: AuthUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: ChangeRoleDto,
  ): Promise<UserResponseDto> {
    return this.admin.changeRole(actor.id, userId, dto.role);
  }

  @Delete(':userId')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Close an account: pending bookings cancelled, sessions revoked',
  })
  @ApiNoContentResponse()
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'The user has a seat in use' })
  close(
    @CurrentAuthUser() actor: AuthUser,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    return this.accounts.closeByAdmin(actor.id, userId);
  }

  @Post(':userId/restore')
  @HttpCode(204)
  @ApiOperation({ summary: 'Reopen a closed account' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse()
  restore(
    @CurrentAuthUser() actor: AuthUser,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    return this.accounts.restore(actor.id, userId);
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

  @Post(':userId/verify-email')
  @HttpCode(204)
  @ApiOperation({ summary: 'Mark the email as verified (support case)' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse()
  verifyEmail(
    @CurrentAuthUser() actor: AuthUser,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    return this.accounts.verifyEmail(actor.id, userId);
  }

  @Get(':userId/sessions')
  @ApiOperation({ summary: "The user's signed-in devices" })
  @ApiOkResponse({ type: [SessionResponseDto] })
  @ApiNotFoundResponse()
  async sessions(
    @CurrentAuthUser() actor: AuthUser,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<SessionResponseDto[]> {
    const list = await this.accounts.listSessions(actor.id, userId);
    return list.map((s) => ({
      id: s.id,
      userAgent: s.userAgent,
      ip: s.ip,
      lastActiveAt: s.lastActiveAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      current: false,
    }));
  }

  @Post(':userId/revoke-sessions')
  @HttpCode(204)
  @ApiOperation({ summary: 'Sign the user out everywhere (without suspending)' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse()
  revokeSessions(
    @CurrentAuthUser() actor: AuthUser,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    return this.accounts.revokeSessions(actor.id, userId);
  }

  @Get(':userId/notifications')
  @ApiOperation({ summary: "The user's alert history, including delivery errors" })
  @ApiOkResponse({ type: NotificationPageResponseDto })
  @ApiNotFoundResponse()
  notifications(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query() query: PaginationQueryDto,
  ): Promise<NotificationPageResponseDto> {
    return this.users.notificationsOf(userId, query.page, query.limit, true);
  }

  @Get(':userId/activity')
  @ApiOperation({ summary: 'Audit trail of booking events by or about the user' })
  @ApiOkResponse({ type: ActivityPageResponseDto })
  @ApiNotFoundResponse()
  activity(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query() query: PaginationQueryDto,
  ): Promise<ActivityPageResponseDto> {
    return this.users.activityOf(userId, query.page, query.limit, true);
  }
}
