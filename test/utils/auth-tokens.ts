import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';

// Signs an access token with the app's own JwtService (same secret and expiry
// as login), for e2e tests of endpoints other than /auth/*.
// Why not register -> verify-email -> login over HTTP: login requires a
// verified email, and the OTP is only stored as a hash and sent by mail, so a
// test would have to read it from Mailpit. Auth e2e tests should do that flow;
// everyone else just needs a valid token. AuthGuard only verifies the JWT
// (no DB lookup), so `sub` doesn't need to be a real user.
export function signToken(
  app: INestApplication,
  role: 'ADMIN' | 'USER',
): Promise<string> {
  return app
    .get(JwtService)
    .signAsync({ sub: randomUUID(), email: `${role}@example.com`, role });
}
