import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidationOptions,
  registerDecorator,
} from 'class-validator';

const MAX_KEYS = 20;
const MAX_KEY_LEN = 30;
const MAX_STR_LEN = 50;

function isSeatFeatures(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false;
  const entries = Object.entries(value);
  return (
    entries.length <= MAX_KEYS &&
    entries.every(
      ([k, v]) =>
        k.length >= 1 &&
        k.length <= MAX_KEY_LEN &&
        (typeof v === 'boolean' ||
          (typeof v === 'number' && Number.isFinite(v)) ||
          (typeof v === 'string' && v.length <= MAX_STR_LEN)),
    )
  );
}

export function IsSeatFeatures(options?: ValidationOptions) {
  return (target: object, propertyName: string) =>
    registerDecorator({
      name: 'isSeatFeatures',
      target: target.constructor,
      propertyName,
      options: {
        message: `features must be a flat object (max ${MAX_KEYS} keys, key 1..${MAX_KEY_LEN} chars, values boolean, number or string <= ${MAX_STR_LEN} chars)`,
        ...options,
      },
      validator: { validate: isSeatFeatures },
    });
}

export class CreateSeatDto {
  @ApiProperty({ minLength: 1, maxLength: 30, example: 'A1' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 30)
  label: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  areaId?: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    example: { power: true, desk: 'large' },
  })
  @IsOptional()
  @IsSeatFeatures()
  features?: Record<string, boolean | number | string>;
}
