import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { SortablePaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { normalizeRoleName, ROLE_NAME_MAX } from './create-role.dto';

export const ROLE_SORT_FIELDS = ['id', 'name'] as const;
export type RoleSortField = (typeof ROLE_SORT_FIELDS)[number];

export class RoleQueryDto extends SortablePaginationQueryDto(ROLE_SORT_FIELDS, 'id') {
  @ApiPropertyOptional({
    maxLength: ROLE_NAME_MAX,
    description: 'Roles whose name contains this text (case-insensitive)',
  })
  @IsOptional()
  @Transform(normalizeRoleName)
  @IsString()
  @Length(1, ROLE_NAME_MAX)
  search?: string;
}

/** Postgres `integer` (SERIAL) upper bound: larger ids would 500 instead of 404. */
const PG_INT_MAX = 2_147_483_647;

export class RoleIdParamDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PG_INT_MAX)
  id: number;
}
