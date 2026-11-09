import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsObject,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PlaceType } from '../../common/enums';
import { BookingPolicyDto } from './booking-policy.dto';
import { ClosureDto } from './closure.dto';
import { OpeningHourDto } from './opening-hour.dto';
import {
  IsIanaTimeZone,
  MAX_CLOSURES,
  canonicalTimeZone,
  trim,
} from './create-place.dto';

// Not PartialType: its @IsOptional also skips null, and null on a NOT NULL
// column would reach Postgres and 500. Here undefined means "unchanged";
// only description, lat and lng may be set to null (cleared).
const present = (_: unknown, v: unknown) => v !== undefined;
const notNull = (_: unknown, v: unknown) => v !== undefined && v !== null;

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
  @Transform(trim)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional({ minLength: 1, maxLength: 255 })
  @Transform(trim)
  @ValidateIf(present)
  @IsString()
  @Length(1, 255)
  address?: string;

  @ApiPropertyOptional({ minimum: -90, maximum: 90, nullable: true })
  @ValidateIf(notNull)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  lat?: number | null;

  @ApiPropertyOptional({ minimum: -180, maximum: 180, nullable: true })
  @ValidateIf(notNull)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  lng?: number | null;

  @ApiPropertyOptional({ example: 'Asia/Phnom_Penh' })
  @Transform(canonicalTimeZone)
  @ValidateIf(present)
  @IsIanaTimeZone()
  timezone?: string;

  @ApiPropertyOptional()
  @ValidateIf(present)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    type: [OpeningHourDto],
    description:
      'Replaces ALL opening hours of the place. [] closes it every day.',
  })
  @ValidateIf(present)
  @IsArray()
  @ArrayMaxSize(7)
  @ArrayUnique((h: OpeningHourDto) => h?.weekday, {
    message: 'openingHours must not repeat a weekday',
  })
  @ValidateNested({ each: true })
  @Type(() => OpeningHourDto)
  openingHours?: OpeningHourDto[];

  @ApiPropertyOptional({
    type: [ClosureDto],
    maxItems: MAX_CLOSURES,
    description: 'Replaces ALL closures of the place. [] removes them.',
  })
  @ValidateIf(present)
  @IsArray()
  @ArrayMaxSize(MAX_CLOSURES)
  @ArrayUnique((c: ClosureDto) => c?.date, {
    message: 'closures must not repeat a date',
  })
  @ValidateNested({ each: true })
  @Type(() => ClosureDto)
  closures?: ClosureDto[];

  @ApiPropertyOptional({
    type: BookingPolicyDto,
    description:
      'Merged into the current policy; omitted fields are unchanged.',
  })
  @ValidateIf(present)
  @IsObject()
  @ValidateNested()
  @Type(() => BookingPolicyDto)
  bookingPolicy?: BookingPolicyDto;
}
