import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { HH_MM, YYYY_MM_DD } from './place-validators';

export class OpeningHourDto {
  @ApiProperty({
    minimum: 0,
    maximum: 6,
    description: '0 = Sunday .. 6 = Saturday',
    example: 1,
  })
  @IsInt()
  @Min(0)
  @Max(6)
  weekday: number;

  @ApiProperty({
    example: '08:00',
    description: 'Local time in the place timezone, HH:mm',
  })
  @Matches(HH_MM, { message: 'openTime must be HH:mm' })
  openTime: string;

  @ApiProperty({
    example: '20:00',
    description: 'Local time, HH:mm. With closesNextDay, on the following day',
  })
  @Matches(HH_MM, { message: 'closeTime must be HH:mm' })
  closeTime: string;

  @ApiPropertyOptional({
    default: false,
    description:
      'Overnight venue: closeTime is on the next day. 00:00-00:00 with closesNextDay = open 24 h',
  })
  @IsOptional()
  @IsBoolean()
  closesNextDay?: boolean;
}

export class PlaceClosureDto {
  @ApiProperty({
    example: '2026-12-25',
    description: 'Local date in the place timezone',
  })
  @Matches(YYYY_MM_DD, { message: 'date must be YYYY-MM-DD' })
  @IsISO8601({ strict: true })
  date: string;

  @ApiPropertyOptional({ maxLength: 255, nullable: true })
  @IsOptional()
  @IsString()
  @Length(0, 255)
  reason?: string | null;
}
