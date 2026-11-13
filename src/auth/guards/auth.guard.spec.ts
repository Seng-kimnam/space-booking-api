import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthGuard } from './auth.guard';
import { jwtModuleOptions } from '../config/jwt-options';

// docs/auth.md "JWT configuration": the guard verifies with the same options
// AuthModule registers (jwt-options.ts), using a real JwtService.

const config = {
  jwtSecret: 'a'.repeat(32),
  jwtAccessExpiresIn: '15m',
  jwtIssuer: 'space-booking-api',
  jwtAudience: 'space-booking-api',
};
const jwt = new JwtService(jwtModuleOptions(config));
const guard = new AuthGuard(jwt);

const contextFor = (token: string) => {
  const request = {
    method: 'GET',
    path: '/api/v1/auth/me',
    headers: { authorization: `Bearer ${token}` },
  } as { user?: Record<string, unknown> } & object;
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
};

const payload = { sub: 'user-id', role: 'USER' };
const rejects = (token: string) =>
  expect(guard.canActivate(contextFor(token).context)).rejects.toBeInstanceOf(
    UnauthorizedException,
  );

describe('AuthGuard JWT verification', () => {
  it('accepts a token signed with the module options', async () => {
    const { context, request } = contextFor(await jwt.signAsync(payload));

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toMatchObject({
      ...payload,
      iss: 'space-booking-api',
      aud: 'space-booking-api',
    });
  });

  it('rejects a token signed with another secret', async () => {
    await rejects(await jwt.signAsync(payload, { secret: 'b'.repeat(32) }));
  });

  it('rejects another HMAC algorithm with the right secret (HS256 pinned)', async () => {
    await rejects(await jwt.signAsync(payload, { algorithm: 'HS512' }));
  });

  it('rejects an unsigned token (alg none)', async () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    await rejects(`${b64({ alg: 'none', typ: 'JWT' })}.${b64(payload)}.`);
  });

  it('rejects a tampered payload (role changed, signature kept)', async () => {
    const [header, , signature] = (await jwt.signAsync(payload)).split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...payload, role: 'SUPER_ADMIN' }),
    ).toString('base64url');
    await rejects(`${header}.${forged}.${signature}`);
  });

  it('rejects an expired token', async () => {
    await rejects(await jwt.signAsync(payload, { expiresIn: -10 }));
  });

  it('rejects a token for another issuer or audience', async () => {
    await rejects(await jwt.signAsync(payload, { issuer: 'someone-else' }));
    await rejects(await jwt.signAsync(payload, { audience: 'another-api' }));
  });

  it('honours a numeric JWT_ACCESS_EXPIRES_IN (seconds)', () => {
    expect(
      jwtModuleOptions({ ...config, jwtAccessExpiresIn: '900' }).signOptions
        ?.expiresIn,
    ).toBe(900);
  });
});
