import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  ValidateIf,
} from 'class-validator';
import { Area } from '../entities/area.entity';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const present = (_: unknown, v: unknown) => v !== undefined;
const presentNotNull = (_: unknown, v: unknown) =>
  v !== undefined && v !== null;

export class CreateAreaDto {
  @ApiProperty({ minLength: 1, maxLength: 100, example: 'Quiet zone' })
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  name: string;

  @ApiPropertyOptional({ maxLength: 30, example: '2' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 30)
  floor?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @Length(0, 2000)
  description?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// Not PartialType: its @IsOptional also skips null, and null on a NOT NULL
// column would reach Postgres and return 500. floor/description may be null (clears them).
export class UpdateAreaDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 100 })
  @Transform(trim)
  @ValidateIf(present)
  @IsString()
  @Length(1, 100)
  name?: string;

  @ApiPropertyOptional({ maxLength: 30, nullable: true })
  @Transform(trim)
  @ValidateIf(presentNotNull)
  @IsString()
  @Length(1, 30)
  floor?: string | null;

  @ApiPropertyOptional({ maxLength: 2000, nullable: true })
  @ValidateIf(presentNotNull)
  @IsString()
  @Length(0, 2000)
  description?: string | null;

  @ApiPropertyOptional()
  @ValidateIf(present)
  @IsBoolean()
  isActive?: boolean;
}

export class AreaResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) placeId: string;
  @ApiProperty() name: string;
  @ApiProperty({ nullable: true, type: String }) floor: string | null;
  @ApiProperty({ nullable: true, type: String }) description: string | null;
  @ApiProperty() isActive: boolean;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  @ApiProperty({ format: 'date-time' }) updatedAt: string;
}

export class AreaPageResponseDto {
  @ApiProperty({ type: [AreaResponseDto] }) items: AreaResponseDto[];
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() total: number;
}

// Explicit copy so internal fields (deletedAt, relations) never leak.
export function toAreaResponse(a: Area): AreaResponseDto {
  return {
    id: a.id,
    placeId: a.placeId,
    name: a.name,
    floor: a.floor,
    description: a.description,
    isActive: a.isActive,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}
