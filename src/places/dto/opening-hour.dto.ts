import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  Matches,
  Max,
  Min,
  ValidationArguments,
  ValidationOptions,
  registerDecorator,
} from 'class-validator';

const TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const TIME_MESSAGE =
  '$property must be a time in HH:mm or HH:mm:ss (00:00-23:59)';

// 'HH:mm' -> 'HH:mm:ss', so string comparison orders times correctly.
export const normalizeTime = (t: string): string =>
  t.length === 5 ? `${t}:00` : t;

// Same day: open < close. Overnight (closesNextDay): close <= open, so a window
// never exceeds 24h; 00:00 -> 00:00 overnight means open all day.
function isValidCloseTime(close: unknown, args: ValidationArguments): boolean {
  const { openTime, closesNextDay } = args.object as OpeningHourDto;
  if (typeof close !== 'string' || typeof openTime !== 'string') return true; // format errors are reported by @Matches
  if (!TIME.test(close) || !TIME.test(openTime)) return true;
  const open = normalizeTime(openTime);
  const end = normalizeTime(close);
  return closesNextDay === true ? end <= open : open < end;
}

function IsValidCloseTime(options?: ValidationOptions) {
  return (target: object, propertyName: string) =>
    registerDecorator({
      name: 'isValidCloseTime',
      target: target.constructor,
      propertyName,
      options: {
        message:
          'closeTime must be after openTime, or at/before openTime when closesNextDay is true',
        ...options,
      },
      validator: { validate: isValidCloseTime },
    });
}

export class OpeningHourDto {
  @ApiProperty({
    minimum: 0,
    maximum: 6,
    example: 1,
    description: '0 = Sunday .. 6 = Saturday, in the place timezone',
  })
  @IsInt()
  @Min(0)
  @Max(6)
  weekday: number;

  @ApiProperty({ example: '07:00', description: 'Local time, HH:mm[:ss]' })
  @Matches(TIME, { message: TIME_MESSAGE })
  openTime: string;

  @ApiProperty({ example: '21:00', description: 'Local time, HH:mm[:ss]' })
  @Matches(TIME, { message: TIME_MESSAGE })
  @IsValidCloseTime()
  closeTime: string;

  @ApiPropertyOptional({
    default: false,
    description: 'true when closeTime is on the following day (overnight)',
  })
  @IsOptional()
  @IsBoolean()
  closesNextDay?: boolean;
}
