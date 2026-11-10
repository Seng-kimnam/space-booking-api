import { ValidationPipeOptions } from '@nestjs/common';

/**
 * The one global ValidationPipe config, shared by main.ts and the e2e app
 * factory (test/utils/create-test-app.ts) so tests validate like production.
 * - whitelist + forbidNonWhitelisted: unknown fields are a 400 (AGENTS.md section 8).
 * - transform: handlers get DTO instances, so @Type/@Transform run and query
 *   defaults (page = 1, limit = 20) apply; "2" in a query becomes 2.
 */
export const VALIDATION_PIPE_OPTIONS: ValidationPipeOptions = {
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
};
