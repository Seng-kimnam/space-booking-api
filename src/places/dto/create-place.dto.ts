import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
  ValidationOptions,
  registerDecorator,
} from 'class-validator';
import { PlaceType } from '../../common/enums';
import { BookingPolicyDto } from './booking-policy.dto';
import { ClosureDto } from './closure.dto';
import { OpeningHourDto } from './opening-hour.dto';

export const MAX_CLOSURES = 366;

export const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// Canonical spelling ('asia/phnom_penh' -> 'Asia/Phnom_Penh'); invalid input is
// left as is so the validator reports it.
export const canonicalTimeZone = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: value.trim(),
    }).resolvedOptions().timeZone;
  } catch {
    return value;
  }
};

// Named IANA zones only. Raw offsets like '+07:00' are rejected: Postgres reads
// them as POSIX offsets with the sign inverted, which would shift every
// opening-hours check by twice the offset.
function isIanaTimeZone(value: unknown): boolean {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(value))
    return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function IsIanaTimeZone(options?: ValidationOptions) {
  return (target: object, propertyName: string) =>
    registerDecorator({
      name: 'isIanaTimeZone',
      target: target.constructor,
      propertyName,
      options: {
        message:
          '$property must be an IANA time zone name, e.g. Asia/Phnom_Penh',
        ...options,
      },
      validator: { validate: isIanaTimeZone },
    });
}

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
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({
    minLength: 1,
    maxLength: 255,
    example: 'Street 240, Phnom Penh',
  })
  @Transform(trim)
  @IsString()
  @Length(1, 255)
  address: string;

  @ApiPropertyOptional({ minimum: -90, maximum: 90, example: 11.5636 })
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  lat?: number;

  @ApiPropertyOptional({ minimum: -180, maximum: 180, example: 104.9282 })
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  lng?: number;

  @ApiPropertyOptional({
    default: 'Asia/Phnom_Penh',
    example: 'Asia/Phnom_Penh',
  })
  @IsOptional()
  @Transform(canonicalTimeZone)
  @IsIanaTimeZone()
  timezone?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    type: [OpeningHourDto],
    description: 'At most one entry per weekday. Weekdays left out are closed.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @ArrayUnique((h: OpeningHourDto) => h?.weekday, {
    message: 'openingHours must not repeat a weekday',
  })
  @ValidateNested({ each: true })
  @Type(() => OpeningHourDto)
  openingHours?: OpeningHourDto[];

  @ApiPropertyOptional({ type: [ClosureDto], maxItems: MAX_CLOSURES })
  @IsOptional()
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
      'Omitted fields use the defaults (grace 15 min, 30-240 min bookings, ...)',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => BookingPolicyDto)
  bookingPolicy?: BookingPolicyDto;
}
