import { registerAs } from '@nestjs/config';

// LOG_FORMAT: "json" (structured, for Loki) or "pretty" (human readable).
// Defaults to json in production and pretty everywhere else.
// LOG_FILE: optional path; when set, logs are also written there as JSON lines.
export const loggerConfig = registerAs('logger', () => {
  const defaultFormat =
    process.env.NODE_ENV === 'production' ? 'json' : 'pretty';

  return {
    json: (process.env.LOG_FORMAT ?? defaultFormat) === 'json',
    file: process.env.LOG_FILE || undefined,
  };
});
