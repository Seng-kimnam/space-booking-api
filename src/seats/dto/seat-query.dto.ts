import { ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { SeatStatus } from '../../common/enums';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class SeatQueryDto extends PaginationQueryDto {
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
}

export class PlaceSeatQueryDto extends OmitType(SeatQueryDto, ['placeId']) {}
