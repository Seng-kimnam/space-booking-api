import { ConfigType } from '@nestjs/config';
import { JwtModuleOptions } from '@nestjs/jwt';
import { authConfig } from '../../configuration/auth.config';

type ExpiresIn = NonNullable<
  NonNullable<JwtModuleOptions['signOptions']>['expiresIn']
>;

/**
 * JwtModule options built from authConfig (docs/auth.md, "JWT configuration").
 * - HS256 only, on both sides: verify never accepts another algorithm, even
 *   one the library would allow for an HMAC secret (HS384/HS512).
 * - Issuer and audience are set when signing and required when verifying.
 * - The lifetime honours JWT_ACCESS_EXPIRES_IN (validated in env.validation.ts).
 * Shared by AuthModule and the guard's unit tests, so both verify the same way.
 */
export function jwtModuleOptions(
  auth: ConfigType<typeof authConfig>,
): JwtModuleOptions {
  const expiresIn: ExpiresIn = /^\d+$/.test(auth.jwtAccessExpiresIn)
    ? Number(auth.jwtAccessExpiresIn)
    : (auth.jwtAccessExpiresIn as ExpiresIn);
  return {
    secret: auth.jwtSecret,
    signOptions: {
      algorithm: 'HS256',
      expiresIn,
      issuer: auth.jwtIssuer,
      audience: auth.jwtAudience,
    },
    verifyOptions: {
      algorithms: ['HS256'],
      issuer: auth.jwtIssuer,
      audience: auth.jwtAudience,
    },
  };
}
