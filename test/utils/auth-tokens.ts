import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';

// Signs an access token with the app's own JwtService (same secret, algorithm,
// issuer/audience and expiry as login), for e2e tests of endpoints other than
// the login flow itself. AuthGuard only verifies the JWT (no DB lookup), so by
// default `sub` is a random UUID. Pass a real user id when the service reads
// the caller from the database (admin approval, account suspension).
// The payload matches AuthService.issueSession: { sub, role }, no email.
export function signToken(
  app: INestApplication,
  role: 'SUPER_ADMIN' | 'ADMIN' | 'USER',
  sub: string = randomUUID(),
): Promise<string> {
  return app.get(JwtService).signAsync({ sub, role });
}
