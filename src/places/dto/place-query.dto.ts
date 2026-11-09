import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, Length } from 'class-validator';
import { PlaceType } from '../../common/enums';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { trim } from './place-validators';

export class PlaceQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    maxLength: 100,
    description: 'Matches name or address (case-insensitive)',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  q?: string;

  @ApiPropertyOptional({ enum: PlaceType })
  @IsOptional()
  @IsEnum(PlaceType)
  type?: PlaceType;
}
