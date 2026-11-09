import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsLatitude,
  IsLongitude,
  IsObject,
  IsString,
  Length,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PlaceType } from '../../common/enums';
import { BookingPolicyDto } from './booking-policy.dto';
import { MAX_CLOSURES } from './create-place.dto';
import { OpeningHourDto, PlaceClosureDto } from './opening-hour.dto';
import {
  IsIanaTimezone,
  present,
  presentNotNull,
  trim,
} from './place-validators';

// Not PartialType: its @IsOptional also skips null, and null on a NOT NULL
// column would reach Postgres and return 500. Only undefined means "unchanged";
// description, lat and lng alone may be null (clears them).
export class UpdatePlaceDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 150 })
  @Transform(trim)
  @ValidateIf(present)
  @IsString()
  @Length(1, 150)
  name?: string;

  @ApiPropertyOptional({ enum: PlaceType })
  @ValidateIf(present)
  @IsEnum(PlaceType)
  type?: PlaceType;

  @ApiPropertyOptional({ maxLength: 2000, nullable: true })
  @ValidateIf(presentNotNull)
  @IsString()
  @Length(0, 2000)
  description?: string | null;

  @ApiPropertyOptional({ minLength: 1, maxLength: 255 })
  @Transform(trim)
  @ValidateIf(present)
  @IsString()
  @Length(1, 255)
  address?: string;

  @ApiPropertyOptional({ minimum: -90, maximum: 90, nullable: true })
  @ValidateIf(presentNotNull)
  @IsLatitude()
  lat?: number | null;

  @ApiPropertyOptional({ minimum: -180, maximum: 180, nullable: true })
  @ValidateIf(presentNotNull)
  @IsLongitude()
  lng?: number | null;

  @ApiPropertyOptional({ description: 'IANA time zone' })
  @ValidateIf(present)
  @IsIanaTimezone()
  timezone?: string;

  @ApiPropertyOptional()
  @ValidateIf(present)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    type: [OpeningHourDto],
    description:
      'Replaces the whole weekly schedule when sent ([] = closed every day)',
  })
  @ValidateIf(present)
  @IsArray()
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => OpeningHourDto)
  openingHours?: OpeningHourDto[];

  @ApiPropertyOptional({
    type: [PlaceClosureDto],
    description: 'Replaces the whole closure list when sent ([] = no closures)',
  })
  @ValidateIf(present)
  @IsArray()
  @ArrayMaxSize(MAX_CLOSURES)
  @ValidateNested({ each: true })
  @Type(() => PlaceClosureDto)
  closures?: PlaceClosureDto[];

  @ApiPropertyOptional({
    type: BookingPolicyDto,
    description: 'Only the fields sent change',
  })
  @ValidateIf(present)
  @IsObject()
  @ValidateNested()
  @Type(() => BookingPolicyDto)
  policy?: BookingPolicyDto;
}
