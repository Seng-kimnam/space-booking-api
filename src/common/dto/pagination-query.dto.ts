import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

/** Base for every list query: `?page&limit`. Pages are `{ items, page, limit, total }`. */
export class PaginationQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}

export enum SortOrder {
  ASC = 'ASC',
  DESC = 'DESC',
}

/** The query shape `applySort` reads (common/utils/pagination.ts). */
export interface SortQuery<K extends string> {
  sortBy?: K;
  order?: SortOrder;
}

/**
 * PaginationQueryDto plus `?sortBy&order`, where `sortBy` is limited to the
 * endpoint's allowlist. The allowlist is what keeps user input out of
 * ORDER BY: each name maps to a fixed column in the service (`SortSpec`).
 *
 *   export class PlaceQueryDto extends SortablePaginationQueryDto(['name', 'createdAt'] as const, 'name') {}
 */
export function SortablePaginationQueryDto<K extends string>(
  fields: readonly K[],
  defaultSortBy: K,
  sortByDescription?: string,
) {
  class SortablePaginationQuery
    extends PaginationQueryDto
    implements SortQuery<K>
  {
    @ApiPropertyOptional({
      enum: fields,
      default: defaultSortBy,
      description: sortByDescription,
    })
    @IsOptional()
    @IsIn(fields)
    sortBy?: K;

    @ApiPropertyOptional({
      enum: SortOrder,
      description:
        "Defaults to the endpoint's natural order for the default sortBy, else ASC",
    })
    @IsOptional()
    @IsEnum(SortOrder)
    order?: SortOrder;
  }
  return SortablePaginationQuery;
}
