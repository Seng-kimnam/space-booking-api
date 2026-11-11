import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { API_CLIENT_SCOPES } from '../api-key';
import type { ApiClientScope } from '../api-key';
import type { ApiClient } from '../entities/api-client.entity';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateApiClientDto {
  @ApiProperty({ maxLength: 100, example: 'LibraFlow LMS' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({ enum: API_CLIENT_SCOPES, isArray: true, example: ['places:read'] })
  @IsArray()
  @ArrayUnique()
  @IsIn(API_CLIENT_SCOPES, { each: true })
  scopes: ApiClientScope[];
}

export class UpdateApiClientDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ enum: API_CLIENT_SCOPES, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(API_CLIENT_SCOPES, { each: true })
  scopes?: ApiClientScope[];

  @ApiPropertyOptional({ description: 'false cuts the client off immediately' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ApiClientResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty({ description: 'Identifies the key (sbk_<env>_<keyPrefix>_…); not secret' })
  keyPrefix: string;
  @ApiProperty({ enum: API_CLIENT_SCOPES, isArray: true }) scopes: string[];
  @ApiProperty() isActive: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) lastUsedAt: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
}

export class ApiClientWithKeyResponseDto extends ApiClientResponseDto {
  @ApiProperty({
    description: 'The full API key. Shown only in this response; store it in the partner system now.',
    example: 'sbk_live_3F9kQ2aB_Qm9yZ2VkLWJ5LWEtcmFuZG9tLTMyLWJ5dGUtc2VjcmV0',
  })
  apiKey: string;
}

export class ApiClientPageResponseDto {
  @ApiProperty({ type: [ApiClientResponseDto] }) items: ApiClientResponseDto[];
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() total: number;
}

/** Never includes api_key_hash. */
export function toApiClientResponse(c: ApiClient): ApiClientResponseDto {
  return {
    id: c.id,
    name: c.name,
    keyPrefix: c.keyPrefix,
    scopes: c.scopes,
    isActive: c.isActive,
    lastUsedAt: c.lastUsedAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
  };
}
