import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { UserRole } from '../../common/enums';
import { AdminRequestStatus, User } from '../entities/user.entity';

const NO_CONTROL_CHARS = /^[^\p{Cc}]*$/u;
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// Not PartialType: its @IsOptional also lets null through, and null on the
// NOT NULL `name` column would reach Postgres as a 500. Only undefined means
// "unchanged"; avatarUrl alone may be null (clears it).
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

export class ListUsersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({ type: Boolean, description: 'false = suspended accounts' })
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ enum: AdminRequestStatus })
  @IsOptional()
  @IsEnum(AdminRequestStatus)
  adminRequestStatus?: AdminRequestStatus;

  @ApiPropertyOptional({ maxLength: 100, description: 'Case-insensitive match on name or email' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;
}

/** Admin view of an account. Never includes the password hash or provider ids. */
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
}

export class UserPageResponseDto {
  @ApiProperty({ type: [UserResponseDto] }) items: UserResponseDto[];
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() total: number;
}

/** The caller's own profile: the /auth/me fields plus avatarUrl. */
export class MyProfileResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 'john@example.com' }) email: string;
  @ApiProperty({ example: 'John Doe' }) name: string;
  @ApiProperty({ enum: UserRole }) role: UserRole;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) emailVerifiedAt: string | null;
  @ApiProperty({ type: String, nullable: true }) avatarUrl: string | null;
}

export function toUserResponse(u: User): UserResponseDto {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    avatarUrl: u.avatarUrl,
    role: u.role.name as UserRole,
    isActive: u.isActive,
    emailVerifiedAt: u.emailVerifiedAt?.toISOString() ?? null,
    noShowCount: u.noShowCount,
    adminRequestStatus: u.adminRequestStatus,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
  };
}

export function toMyProfile(u: User): MyProfileResponseDto {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role.name as UserRole,
    emailVerifiedAt: u.emailVerifiedAt?.toISOString() ?? null,
    avatarUrl: u.avatarUrl,
  };
}
