import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, Max, Min, ValidateIf } from 'class-validator';
import { present } from './place-validators';

// smallint columns; cross-field rules (max >= min, late alert <= grace) are
// checked in BookingPoliciesService against the merged row, since a PATCH may
// send only one side of the pair.
const SMALLINT_MAX = 32767;

/** Every field optional: on create, missing fields take the DB defaults. */
export class BookingPolicyDto {
  @ApiPropertyOptional({
    minimum: 0,
    default: 15,
    description: 'PENDING expires at start + N',
  })
  @ValidateIf(present)
  @IsInt()
  @Min(0)
  @Max(SMALLINT_MAX)
  checkinGraceMinutes?: number;

  @ApiPropertyOptional({
    minimum: 0,
    default: 5,
    description: 'Late alert at start + N; must be <= checkinGraceMinutes',
  })
  @ValidateIf(present)
  @IsInt()
  @Min(0)
  @Max(SMALLINT_MAX)
  lateCheckinAlertMinutes?: number;

  @ApiPropertyOptional({
    minimum: 0,
    default: 15,
    description: 'Checkout reminder at end - N',
  })
  @ValidateIf(present)
  @IsInt()
  @Min(0)
  @Max(SMALLINT_MAX)
  checkoutReminderMinutes?: number;

  @ApiPropertyOptional({
    minimum: 0,
    default: 15,
    description: 'CHECKOUT_OVERDUE at end + N',
  })
  @ValidateIf(present)
  @IsInt()
  @Min(0)
  @Max(SMALLINT_MAX)
  overdueAlertMinutes?: number;

  @ApiPropertyOptional({ minimum: 1, default: 30 })
  @ValidateIf(present)
  @IsInt()
  @Min(1)
  @Max(SMALLINT_MAX)
  minMinutes?: number;

  @ApiPropertyOptional({
    minimum: 1,
    default: 240,
    description: 'Must be >= minMinutes',
  })
  @ValidateIf(present)
  @IsInt()
  @Min(1)
  @Max(SMALLINT_MAX)
  maxMinutes?: number;

  @ApiPropertyOptional({
    minimum: 1,
    default: 15,
    description: 'Start/end must align to this',
  })
  @ValidateIf(present)
  @IsInt()
  @Min(1)
  @Max(SMALLINT_MAX)
  slotMinutes?: number;

  @ApiPropertyOptional({ minimum: 0, default: 7 })
  @ValidateIf(present)
  @IsInt()
  @Min(0)
  @Max(SMALLINT_MAX)
  maxAdvanceDays?: number;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @ValidateIf(present)
  @IsInt()
  @Min(1)
  @Max(SMALLINT_MAX)
  maxActivePerUser?: number;

  @ApiPropertyOptional({ minimum: 0, default: 2 })
  @ValidateIf(present)
  @IsInt()
  @Min(0)
  @Max(SMALLINT_MAX)
  maxExtensions?: number;

  @ApiPropertyOptional({
    minimum: 0,
    default: 30,
    description: 'No modify/cancel later than start - N',
  })
  @ValidateIf(present)
  @IsInt()
  @Min(0)
  @Max(SMALLINT_MAX)
  modifyCutoffMinutes?: number;
}
