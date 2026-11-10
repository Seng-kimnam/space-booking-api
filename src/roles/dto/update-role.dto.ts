import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length, Matches, ValidateIf } from 'class-validator';
import {
  normalizeRoleName,
  ROLE_NAME_MAX,
  ROLE_NAME_MESSAGE,
  ROLE_NAME_PATTERN,
} from './create-role.dto';

// Not PartialType: its @IsOptional also lets null through, and null on the
// NOT NULL name column would reach Postgres as a 500. Here only a missing
// field means "unchanged"; null is validated (and rejected) like any value.
export class UpdateRoleDto {
  @ApiPropertyOptional({
    example: 'SUPERVISOR',
    minLength: 2,
    maxLength: ROLE_NAME_MAX,
    description: 'New name. Same rules as create.',
  })
  @Transform(normalizeRoleName)
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @Length(2, ROLE_NAME_MAX)
  @Matches(ROLE_NAME_PATTERN, { message: ROLE_NAME_MESSAGE })
  name?: string;
}
