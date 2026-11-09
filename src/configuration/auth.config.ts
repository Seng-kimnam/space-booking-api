import { registerAs } from '@nestjs/config';

// JWT access tokens. JWT_SECRET is required and checked at startup
// (env.validation.ts), so the app never runs with an undefined secret.
// The secret is never logged.
export const authConfig = registerAs('auth', () => ({
  jwtSecret: process.env.JWT_SECRET ?? '',
  // Access-token lifetime: a number of seconds or a duration like 15m, 1h, 7d.
  jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
}));
