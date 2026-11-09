import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  MaxLength,
  ValidationOptions,
  registerDecorator,
} from 'class-validator';

// Real calendar date only: '2026-02-30' would otherwise reach Postgres and 500.
function isCalendarDate(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function IsCalendarDate(options?: ValidationOptions) {
  return (target: object, propertyName: string) =>
    registerDecorator({
      name: 'isCalendarDate',
      target: target.constructor,
      propertyName,
      options: {
        message: '$property must be a valid date in YYYY-MM-DD',
        ...options,
      },
      validator: { validate: isCalendarDate },
    });
}

export class ClosureDto {
  @ApiProperty({
    example: '2026-12-25',
    description: 'Local date in the place timezone',
  })
  @IsCalendarDate()
  date: string;

  @ApiPropertyOptional({ maxLength: 255, example: 'Public holiday' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(255)
  reason?: string;
}
