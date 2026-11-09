import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, Max, Min, ValidateIf } from 'class-validator';

// Every field is optional; omitted fields keep their current value (or the
// column default on create). null is rejected: all columns are NOT NULL.
// Upper bounds are sanity limits for the API; the DB enforces the lower ones too.
const present = (_: unknown, v: unknown) => v !== undefined;

export class BookingPolicyDto {
  @ApiPropertyOptional({ minimum: 0, maximum: 240, example: 15 })
  @ValidateIf(present)
  @IsInt()
  @Min(0)
  @Max(240)
  checkinGraceMinutes?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 240, example: 15 })
  @ValidateIf(present)
  @IsInt()
  @Min(0)
  @Max(240)
  checkoutReminderMinutes?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 240, example: 15 })
  @ValidateIf(present)
  @IsInt()
  @Min(0)
  @Max(240)
  overdueAlertMinutes?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 1440, example: 30 })
  @ValidateIf(present)
  @IsInt()
  @Min(1)
  @Max(1440)
  minMinutes?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 1440, example: 240 })
  @ValidateIf(present)
  @IsInt()
  @Min(1)
  @Max(1440)
  maxMinutes?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 240, example: 15 })
  @ValidateIf(present)
  @IsInt()
  @Min(1)
  @Max(240)
  slotMinutes?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 365, example: 7 })
  @ValidateIf(present)
  @IsInt()
  @Min(0)
  @Max(365)
  maxAdvanceDays?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 20, example: 1 })
  @ValidateIf(present)
  @IsInt()
  @Min(1)
  @Max(20)
  maxActivePerUser?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 10, example: 2 })
  @ValidateIf(present)
  @IsInt()
  @Min(0)
  @Max(10)
  maxExtensions?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 1440, example: 30 })
  @ValidateIf(present)
  @IsInt()
  @Min(0)
  @Max(1440)
  modifyCutoffMinutes?: number;
}
