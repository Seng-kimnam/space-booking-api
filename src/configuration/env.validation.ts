// enableImplicitConversion reads design:type metadata; Nest loads this in the
// app, but import it here so the validator also works standalone (unit tests).
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
  ValidateIf,
  validateSync,
} from 'class-validator';

enum NodeEnv {
  development = 'development',
  test = 'test',
  production = 'production',
}

/** A number of seconds ("900") or a duration ("15m", "1h", "7d"), as jsonwebtoken accepts. */
export const JWT_EXPIRES_IN_PATTERN = /^\d+(s|m|h|d)?$/;

/**
 * Environment variables checked once at startup (ConfigModule `validate`).
 * Required ones have no safe default; optional ones are only type-checked here
 * and get their defaults in the registerAs config files.
 */
class EnvironmentVariables {
  @IsOptional()
  @IsEnum(NodeEnv)
  NODE_ENV?: NodeEnv;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT?: number;

  // ---- database (required: the app can't start without it) ----
  @IsOptional()
  @IsString()
  DB_HOST?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  DB_PORT?: number;

  @IsString()
  @IsNotEmpty()
  DB_USERNAME: string;

  @IsString()
  DB_PASSWORD: string;

  @IsString()
  @IsNotEmpty()
  DB_NAME: string;

  // ---- auth ----
  // At least 32 characters: a short HS256 secret can be brute-forced offline
  // from any issued token. Generate one with: openssl rand -base64 48
  @IsString()
  @MinLength(32)
  JWT_SECRET: string;

  @IsOptional()
  @Matches(JWT_EXPIRES_IN_PATTERN, {
    message:
      'JWT_ACCESS_EXPIRES_IN must be seconds (900) or a duration like 15m, 1h, 7d',
  })
  JWT_ACCESS_EXPIRES_IN?: string;

  // ---- mail, redis (optional, defaults in their config files) ----
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  MAIL_PORT?: number;

  // 'true' | 'false' strings, as .env provides them (mail.config.ts).
  @IsOptional()
  @IsIn(['true', 'false'])
  MAIL_SECURE?: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  MAIL_REQUIRE_TLS?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  REDIS_PORT?: number;

  // ---- RabbitMQ (optional: empty = messaging off, rabbitmq.config.ts) ----
  // amqp://user:pass@host:5672/vhost, or amqps:// outside local development.
  @IsOptional()
  @Matches(/^(amqps?:\/\/.+)?$/, {
    message: 'RABBITMQ_URL must start with amqp:// or amqps:// (or be empty)',
  })
  RABBITMQ_URL?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  OUTBOX_RELAY_BATCH?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  RABBITMQ_PREFETCH?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  RABBITMQ_MAX_ATTEMPTS?: number;

  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(86_400_000)
  RABBITMQ_RETRY_DELAY_MS?: number;

  // 'true' turns on the LMS consumer (place.created / place.updated).
  @IsOptional()
  @IsIn(['true', 'false'])
  LIBRARY_INTEGRATION_ENABLED?: string;

  // ---- LMS REST API (optional; empty = place repair job off) ----
  @IsOptional()
  @Matches(/^(https?:\/\/[^\s]+)?$/, {
    message: 'LMS_BASE_URL must be an http(s) URL (or empty)',
  })
  LMS_BASE_URL?: string;

  // Issued by LMS (their SHARED_SERVICE_API_KEY). Required when LMS_BASE_URL is set.
  @ValidateIf((env: EnvironmentVariables) => !!env.LMS_BASE_URL)
  @IsString()
  @MinLength(16, { message: 'LMS_API_KEY must be at least 16 characters when LMS_BASE_URL is set' })
  LMS_API_KEY?: string;

  @IsOptional()
  @IsInt()
  @Min(500)
  @Max(60_000)
  LMS_TIMEOUT_MS?: number;
}

/**
 * Throws at boot with every problem listed, instead of failing later at the
 * first request that needs the value. Messages name the variable, never its value.
 */
export function validateEnv(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const env = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(env, { skipMissingProperties: false });
  if (errors.length > 0) {
    const problems = errors.flatMap((e) =>
      Object.values(e.constraints ?? {}).map((msg) => `  - ${msg}`),
    );
    throw new Error(
      `Invalid environment configuration (check your .env, see .env.example):\n${problems.join('\n')}`,
    );
  }
  // Return the original values: config files do their own parsing and defaults.
  return config;
}
