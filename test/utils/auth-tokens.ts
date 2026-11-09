import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';

// shortcut: signs the token with the app's own JwtService instead of register + login over HTTP,
// because /auth/register currently 500s (User entity maps columns missing from the migration).
// Switch to the real flow once auth is fixed. AuthGuard only verifies the JWT, no DB lookup.
export function signToken(
  app: INestApplication,
  role: 'ADMIN' | 'USER',
): Promise<string> {
  return app
    .get(JwtService)
    .signAsync({ sub: randomUUID(), email: `${role}@example.com`, role });
}
