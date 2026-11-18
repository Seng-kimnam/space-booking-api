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
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthService } from '../../auth/services/auth.service';
import { SessionsService } from '../../auth/services/sessions.service';
import { CurrentAuthUser } from '../../common/decorators/current-auth-user.decorator';
import { Secured } from '../../common/decorators/secured.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { UserRole } from '../../common/enums/index';
import type { AuthUser } from '../../common/types/auth-user';
import { AccountStatusService } from '../services/account-status.service';
import {
  ActivityPageResponseDto,
  BookingSummaryDto,
  ChangeEmailDto,
  ConfirmEmailChangeDto,
  MessageDto,
  MyProfileResponseDto,
  NotificationPageResponseDto,
  PasswordConfirmationDto,
  SessionResponseDto,
  UpdateMyProfileDto,
} from '../dto/user.dto';
import { UsersService } from '../services/users.service';

/** The caller's own account; always the authenticated user, never an id from the request. */
@ApiTags('Users')
@ApiBearerAuth()
@ApiUnauthorizedResponse()
@ApiForbiddenResponse()
@Secured(UserRole.USER, UserRole.ADMIN)
@Controller('users/me')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly accounts: AccountStatusService,
    private readonly sessions: SessionsService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'My profile, sign-in methods and linked accounts' })
  @ApiOkResponse({ type: MyProfileResponseDto })
  getMe(@CurrentAuthUser() user: AuthUser): Promise<MyProfileResponseDto> {
    return this.users.getMe(user.id);
  }

  @Patch()
  @ApiOperation({ summary: 'Update my profile (name, avatar)' })
  @ApiOkResponse({ type: MyProfileResponseDto })
  @ApiBadRequestResponse()
  updateMe(
    @CurrentAuthUser() user: AuthUser,
    @Body() dto: UpdateMyProfileDto,
  ): Promise<MyProfileResponseDto> {
    return this.users.updateMyProfile(user.id, dto);
  }

  @Delete()
  @HttpCode(204)
  @ApiOperation({
    summary: 'Close my account',
    description:
      'Cancels pending bookings and signs out everywhere. The email stays reserved; an admin can restore the account. 409 while checked in to a seat.',
  })
  @ApiNoContentResponse()
  @ApiConflictResponse({ description: 'A seat is in use' })
  closeMe(
    @CurrentAuthUser() user: AuthUser,
    @Body() dto: PasswordConfirmationDto,
  ): Promise<void> {
    return this.accounts.closeOwn(user.id, dto.password);
  }

  @Get('summary')
  @ApiOperation({ summary: 'My booking statistics' })
  @ApiOkResponse({ type: BookingSummaryDto })
  summary(@CurrentAuthUser() user: AuthUser): Promise<BookingSummaryDto> {
    return this.users.summary(user.id);
  }

  @Get('sessions')
  @ApiOperation({ summary: 'Devices where I am signed in' })
  @ApiOkResponse({ type: [SessionResponseDto] })
  async sessionsOf(@CurrentAuthUser() user: AuthUser): Promise<SessionResponseDto[]> {
    const list = await this.sessions.list(user.id);
    return list.map((s) => ({
      id: s.id,
      userAgent: s.userAgent,
      ip: s.ip,
      lastActiveAt: s.lastActiveAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      current: s.id === user.sessionId,
    }));
  }

  @Delete('sessions/:sessionId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Sign out one device' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse()
  revokeSession(
    @CurrentAuthUser() user: AuthUser,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ): Promise<void> {
    return this.sessions.revoke(user.id, sessionId);
  }

  @Get('notifications')
  @ApiOperation({ summary: 'My alert history (Telegram, email)' })
  @ApiOkResponse({ type: NotificationPageResponseDto })
  notifications(
    @CurrentAuthUser() user: AuthUser,
    @Query() query: PaginationQueryDto,
  ): Promise<NotificationPageResponseDto> {
    return this.users.notificationsOf(user.id, query.page, query.limit, false);
  }

  @Get('activity')
  @ApiOperation({ summary: 'History of my bookings (created, modified, checked in, ...)' })
  @ApiOkResponse({ type: ActivityPageResponseDto })
  activity(
    @CurrentAuthUser() user: AuthUser,
    @Query() query: PaginationQueryDto,
  ): Promise<ActivityPageResponseDto> {
    return this.users.activityOf(user.id, query.page, query.limit, false);
  }

  @Post('email')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Start changing my email: a code is mailed to the new address',
    description: 'Same answer whether or not the address is free (no account probing).',
  })
  @ApiAcceptedResponse({ type: MessageDto })
  @ApiBadRequestResponse({ description: 'Same as the current address' })
  requestEmailChange(
    @CurrentAuthUser() user: AuthUser,
    @Body() dto: ChangeEmailDto,
  ): Promise<MessageDto> {
    return this.auth.requestEmailChange(user.id, dto.newEmail, dto.password);
  }

  @Post('email/confirm')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirm the new email with the mailed code' })
  @ApiOkResponse({ type: MyProfileResponseDto })
  @ApiConflictResponse({ description: 'The address was taken in the meantime' })
  async confirmEmailChange(
    @CurrentAuthUser() user: AuthUser,
    @Body() dto: ConfirmEmailChangeDto,
  ): Promise<MyProfileResponseDto> {
    return this.users.profile(await this.auth.confirmEmailChange(user.id, dto.otp));
  }
}
