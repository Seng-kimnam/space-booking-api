import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, Length } from 'class-validator';
import { PlaceType } from '../../common/enums';
import { SortablePaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { trim } from './create-place.dto';

export const PLACE_SORT_FIELDS = ['name', 'createdAt'] as const;
export type PlaceSortField = (typeof PLACE_SORT_FIELDS)[number];

export class PlaceQueryDto extends SortablePaginationQueryDto(PLACE_SORT_FIELDS, 'name') {
  @ApiPropertyOptional({ enum: PlaceType })
  @IsOptional()
  @IsEnum(PlaceType)
  type?: PlaceType;

  @ApiPropertyOptional({
    minLength: 1,
    maxLength: 100,
    description: 'Case-insensitive match on name',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  search?: string;
}
