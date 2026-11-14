import { ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { SeatStatus } from '../../common/enums';
import { SortablePaginationQueryDto } from '../../common/dto/pagination-query.dto';

export const SEAT_SORT_FIELDS = ['label', 'createdAt'] as const;
export type SeatSortField = (typeof SEAT_SORT_FIELDS)[number];

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class SeatQueryDto extends SortablePaginationQueryDto(SEAT_SORT_FIELDS, 'label') {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  placeId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  areaId?: string;

  @ApiPropertyOptional({ enum: SeatStatus })
  @IsOptional()
  @IsEnum(SeatStatus)
  status?: SeatStatus;

  @ApiPropertyOptional({
    minLength: 1,
    maxLength: 30,
    description: 'Case-insensitive match on the seat label',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 30)
  search?: string;
}

export class PlaceSeatQueryDto extends OmitType(SeatQueryDto, ['placeId']) {}
