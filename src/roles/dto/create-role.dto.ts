import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length, Matches } from 'class-validator';

export const ROLE_NAME_MAX = 30;
export const ROLE_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;
export const ROLE_NAME_MESSAGE =
  'name must start with a letter and contain only letters, digits and underscores';

// Normalise so "manager" and " MANAGER " can't become two different roles.
export const normalizeRoleName = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class CreateRoleDto {
  @ApiProperty({
    example: 'MANAGER',
    minLength: 2,
    maxLength: ROLE_NAME_MAX,
    description:
      'Letters, digits and underscores, starting with a letter. Trimmed and uppercased.',
  })
  @Transform(normalizeRoleName)
  @IsString()
  @Length(2, ROLE_NAME_MAX)
  @Matches(ROLE_NAME_PATTERN, { message: ROLE_NAME_MESSAGE })
  name: string;
}
