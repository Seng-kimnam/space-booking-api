import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';
import { PlaceType } from '../../common/enums';
import { BookingPolicyDto } from './booking-policy.dto';
import { OpeningHourDto, PlaceClosureDto } from './opening-hour.dto';
import { IsIanaTimezone, trim } from './place-validators';

/** Bound so one request can't insert an unbounded number of closure rows. */
export const MAX_CLOSURES = 366;

export class CreatePlaceDto {
  @ApiProperty({ minLength: 1, maxLength: 150, example: 'Central Library' })
  @Transform(trim)
  @IsString()
  @Length(1, 150)
  name: string;

  @ApiProperty({ enum: PlaceType, example: PlaceType.LIBRARY })
  @IsEnum(PlaceType)
  type: PlaceType;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @Length(0, 2000)
  description?: string;

  @ApiProperty({ minLength: 1, maxLength: 255, example: 'St. 271, Phnom Penh' })
  @Transform(trim)
  @IsString()
  @Length(1, 255)
  address: string;

  @ApiPropertyOptional({ minimum: -90, maximum: 90, example: 11.5564 })
  @IsOptional()
  @IsLatitude()
  lat?: number;

  @ApiPropertyOptional({ minimum: -180, maximum: 180, example: 104.9282 })
  @IsOptional()
  @IsLongitude()
  lng?: number;

  @ApiPropertyOptional({
    default: 'Asia/Phnom_Penh',
    description: 'IANA time zone',
  })
  @IsOptional()
  @IsIanaTimezone()
  timezone?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    type: [OpeningHourDto],
    description:
      'At most one entry per weekday. A weekday without an entry is closed',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => OpeningHourDto)
  openingHours?: OpeningHourDto[];

  @ApiPropertyOptional({
    type: [PlaceClosureDto],
    description: 'Closed dates (local), at most one per date',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_CLOSURES)
  @ValidateNested({ each: true })
  @Type(() => PlaceClosureDto)
  closures?: PlaceClosureDto[];

  @ApiPropertyOptional({
    type: BookingPolicyDto,
    description: 'Missing fields take the defaults',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => BookingPolicyDto)
  policy?: BookingPolicyDto;
}
