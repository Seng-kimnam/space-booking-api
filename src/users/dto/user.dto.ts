import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { SortablePaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { PageResponseDto } from '../../common/dto/page-response.dto';
import { UserRole } from '../../common/enums';
import { AdminRequestStatus, User } from '../entities/user.entity';
import type {
  LinkedAccounts,
  UserActivityItem,
  UserBookingSummary,
  UserNotificationItem,
} from '../users.ports';

const NO_CONTROL_CHARS = /^[^\p{Cc}]*$/u;
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const lower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
const toBool = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Roles an admin can assign (SUPER_ADMIN comes from the seed only). */
export const ASSIGNABLE_ROLES = [UserRole.USER, UserRole.ADMIN] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

// Requests

// Not PartialType: it would let `name: null` reach the NOT NULL column (500).
// undefined = unchanged; only avatarUrl accepts null (clears it).
export class UpdateMyProfileDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 100, example: 'John Doe' })
  @Transform(trim)
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @Length(1, 100)
  @Matches(NO_CONTROL_CHARS, { message: 'name must not contain control characters' })
  name?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'uri',
    maxLength: 500,
    nullable: true,
    description: 'https URL; null removes the avatar.',
  })
  @ValidateIf((_, v) => v !== undefined && v !== null)
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(500)
  avatarUrl?: string | null;
}

/** Profile fields plus a no-show reset. */
export class AdminUpdateUserDto extends UpdateMyProfileDto {
  @ApiPropertyOptional({ description: 'true sets no_show_count back to 0' })
  @IsOptional()
  @IsBoolean()
  resetNoShowCount?: boolean;
}

export class PasswordConfirmationDto {
  @ApiPropertyOptional({
    example: 'Password123!',
    description: 'Current password. Not needed for accounts that only sign in with Google.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  password?: string;
}

export class ChangeEmailDto extends PasswordConfirmationDto {
  @ApiProperty({ example: 'new.address@example.com', maxLength: 255 })
  @Transform(lower)
  @IsEmail()
  @MaxLength(255)
  newEmail: string;
}

export class ConfirmEmailChangeDto {
  @ApiProperty({ example: '123456', description: 'Code mailed to the new address' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  otp: string;
}

export class CreateUserDto {
  @ApiProperty({ minLength: 1, maxLength: 100, example: 'Jane Doe' })
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  @Matches(NO_CONTROL_CHARS, { message: 'name must not contain control characters' })
  name: string;

  @ApiProperty({ example: 'jane@example.com', maxLength: 255 })
  @Transform(lower)
  @IsEmail()
  @MaxLength(255)
  email: string;

  @ApiPropertyOptional({
    enum: ASSIGNABLE_ROLES,
    default: UserRole.USER,
    description: 'ADMIN only by a SUPER_ADMIN',
  })
  @IsOptional()
  @IsIn(ASSIGNABLE_ROLES)
  role?: AssignableRole;
}

export class ChangeRoleDto {
  @ApiProperty({ enum: ASSIGNABLE_ROLES })
  @IsIn(ASSIGNABLE_ROLES)
  role: AssignableRole;
}

export const USER_SORT_FIELDS = ['createdAt', 'name', 'email'] as const;
export type UserSortField = (typeof USER_SORT_FIELDS)[number];

export class ListUsersQueryDto extends SortablePaginationQueryDto(USER_SORT_FIELDS, 'createdAt') {
  @ApiPropertyOptional({ enum: UserRole })
  @IsOptional()
  @IsIn(Object.values(UserRole))
  role?: UserRole;

  @ApiPropertyOptional({ type: Boolean, description: 'false = suspended accounts' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    type: Boolean,
    default: false,
    description: 'true = only closed (deleted) accounts; default lists open ones',
  })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  deleted?: boolean;

  @ApiPropertyOptional({ enum: AdminRequestStatus })
  @IsOptional()
  @IsIn(Object.values(AdminRequestStatus))
  adminRequestStatus?: AdminRequestStatus;

  @ApiPropertyOptional({ maxLength: 100, description: 'Case-insensitive match on name or email' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;
}

// Responses

export class MessageDto {
  @ApiProperty() message: string;
}

class TelegramLinkDto {
  @ApiProperty() linked: boolean;
  @ApiProperty({ type: String, nullable: true }) username: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) linkedAt: string | null;
}

class ExternalLinkDto {
  @ApiProperty({ example: 'library' }) system: string;
  @ApiProperty() memberId: string;
  @ApiProperty({ format: 'date-time' }) linkedAt: string;
  @ApiProperty({ type: Boolean, nullable: true }) eligible: boolean | null;
}

export class LinkedAccountsDto {
  @ApiProperty({ type: TelegramLinkDto }) telegram: TelegramLinkDto;
  @ApiProperty({ type: [ExternalLinkDto] }) external: ExternalLinkDto[];
}

/** Admin view. Never includes the password hash or provider ids. */
export class UserResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 'John Doe' }) name: string;
  @ApiProperty({ example: 'john@example.com' }) email: string;
  @ApiProperty({ type: String, nullable: true }) avatarUrl: string | null;
  @ApiProperty({ enum: UserRole }) role: UserRole;
  @ApiProperty({ description: 'false = suspended' }) isActive: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) emailVerifiedAt: string | null;
  @ApiProperty() noShowCount: number;
  @ApiProperty({ enum: AdminRequestStatus, nullable: true })
  adminRequestStatus: AdminRequestStatus | null;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  @ApiProperty({ format: 'date-time' }) updatedAt: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'Set = account closed' })
  deletedAt: string | null;
}

export class UserPageResponseDto extends PageResponseDto(UserResponseDto) {}

export class FavouritePlaceDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty() bookings: number;
}

export class BookingSummaryDto {
  @ApiProperty({ description: 'Seat bookings; a multi-seat booking counts once per seat' })
  total: number;
  @ApiProperty() upcoming: number;
  @ApiProperty({ description: 'Checked in or checkout overdue' }) active: number;
  @ApiProperty() completed: number;
  @ApiProperty() cancelled: number;
  @ApiProperty({ description: 'No-shows' }) expired: number;
  @ApiProperty({ description: 'Hours of completed bookings' }) hoursBooked: number;
  @ApiProperty({ type: FavouritePlaceDto, nullable: true }) favouritePlace: FavouritePlaceDto | null;
}

export class UserDetailResponseDto extends UserResponseDto {
  @ApiProperty() hasPassword: boolean;
  @ApiProperty() googleLinked: boolean;
  @ApiProperty({ type: LinkedAccountsDto }) linkedAccounts: LinkedAccountsDto;
  @ApiProperty({ type: BookingSummaryDto }) bookings: BookingSummaryDto;
}

/** The caller's own account. */
export class MyProfileResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 'john@example.com' }) email: string;
  @ApiProperty({ example: 'John Doe' }) name: string;
  @ApiProperty({ enum: UserRole }) role: UserRole;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) emailVerifiedAt: string | null;
  @ApiProperty({ type: String, nullable: true }) avatarUrl: string | null;
  @ApiProperty() noShowCount: number;
  @ApiProperty({ type: String, nullable: true, description: 'Address waiting for confirmation' })
  pendingEmail: string | null;
  @ApiProperty() hasPassword: boolean;
  @ApiProperty() googleLinked: boolean;
  @ApiProperty({ type: LinkedAccountsDto }) linkedAccounts: LinkedAccountsDto;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
}

export class SessionResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ type: String, nullable: true }) userAgent: string | null;
  @ApiProperty({ type: String, nullable: true }) ip: string | null;
  @ApiProperty({ format: 'date-time', description: 'Last sign-in or token refresh on this device' })
  lastActiveAt: string;
  @ApiProperty({ format: 'date-time' }) expiresAt: string;
  @ApiProperty({ description: 'The session making this request' }) current: boolean;
}

export class NotificationResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() type: string;
  @ApiProperty() channel: string;
  @ApiProperty() status: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) bookingId: string | null;
  @ApiProperty({ format: 'date-time' }) scheduledAt: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) sentAt: string | null;
  @ApiProperty() attempts: number;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Admin view only' })
  lastError?: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
}

export class NotificationPageResponseDto extends PageResponseDto(NotificationResponseDto) {}

export class ActivityItemDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) bookingId: string;
  @ApiProperty({ example: 'CANCELLED' }) type: string;
  @ApiProperty({ enum: ['SELF', 'OTHER_USER', 'API_CLIENT', 'SYSTEM'] }) actor: string;
  @ApiProperty({ description: "false: the user acted on someone else's booking" })
  ownBooking: boolean;
  @ApiProperty() placeName: string;
  @ApiProperty() seatLabel: string;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
}

export class ActivityPageResponseDto extends PageResponseDto(ActivityItemDto) {}

class RoleCountDto {
  @ApiProperty({ enum: UserRole }) role: string;
  @ApiProperty() count: number;
}

class TopNoShowDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty() noShowCount: number;
}

export class UserStatsResponseDto {
  @ApiProperty({ description: 'Open (not deleted) accounts' }) total: number;
  @ApiProperty({ type: [RoleCountDto] }) byRole: RoleCountDto[];
  @ApiProperty() active: number;
  @ApiProperty() suspended: number;
  @ApiProperty() unverified: number;
  @ApiProperty() deleted: number;
  @ApiProperty() pendingAdminRequests: number;
  @ApiProperty() newLast7Days: number;
  @ApiProperty() newLast30Days: number;
  @ApiProperty({ type: [TopNoShowDto] }) topNoShows: TopNoShowDto[];
}

// Mappers

export function toUserResponse(u: User): UserResponseDto {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    avatarUrl: u.avatarUrl,
    role: u.role.name as UserRole,
    isActive: u.isActive,
    emailVerifiedAt: iso(u.emailVerifiedAt),
    noShowCount: u.noShowCount,
    adminRequestStatus: u.adminRequestStatus,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
    deletedAt: iso(u.deletedAt),
  };
}

export function toLinkedAccounts(l: LinkedAccounts): LinkedAccountsDto {
  return {
    telegram: {
      linked: l.telegram.linked,
      username: l.telegram.username,
      linkedAt: iso(l.telegram.linkedAt),
    },
    external: l.external.map((e) => ({
      system: e.system,
      memberId: e.memberId,
      linkedAt: e.linkedAt.toISOString(),
      eligible: e.eligible,
    })),
  };
}

export function toBookingSummary(s: UserBookingSummary): BookingSummaryDto {
  return { ...s, hoursBooked: Math.round(s.hoursBooked * 100) / 100 };
}

export function toMyProfile(u: User, linked: LinkedAccounts): MyProfileResponseDto {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role.name as UserRole,
    emailVerifiedAt: iso(u.emailVerifiedAt),
    avatarUrl: u.avatarUrl,
    noShowCount: u.noShowCount,
    pendingEmail: u.pendingEmail,
    hasPassword: !!u.passwordHash,
    googleLinked: !!u.googleId,
    linkedAccounts: toLinkedAccounts(linked),
    createdAt: u.createdAt.toISOString(),
  };
}

export function toNotification(n: UserNotificationItem): NotificationResponseDto {
  return {
    id: n.id,
    type: n.type,
    channel: n.channel,
    status: n.status,
    bookingId: n.bookingId,
    scheduledAt: n.scheduledAt.toISOString(),
    sentAt: iso(n.sentAt),
    attempts: n.attempts,
    ...(n.lastError !== undefined ? { lastError: n.lastError } : {}),
    createdAt: n.createdAt.toISOString(),
  };
}

export function toActivity(a: UserActivityItem): ActivityItemDto {
  return { ...a, createdAt: new Date(a.createdAt).toISOString() };
}
