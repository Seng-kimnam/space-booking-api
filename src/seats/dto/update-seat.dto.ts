import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, IsUUID, Length, ValidateIf } from 'class-validator';
import { IsSeatFeatures } from './create-seat.dto';

// Not PartialType: its @IsOptional also skips null, and null on the NOT NULL
// columns label/features would reach Postgres and return 500. Here only
// undefined means "unchanged"; areaId alone may be null (clears the area).
const present = (_: unknown, v: unknown) => v !== undefined;

export class UpdateSeatDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 30, example: 'A1' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @ValidateIf(present)
  @IsString()
  @Length(1, 30)
  label?: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @ValidateIf((_, v) => v !== undefined && v !== null)
  @IsUUID()
  areaId?: string | null;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @ValidateIf(present)
  @IsSeatFeatures()
  features?: Record<string, boolean | number | string>;
}
