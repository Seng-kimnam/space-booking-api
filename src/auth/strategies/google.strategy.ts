import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy } from 'passport-google-oauth20';

export interface GoogleProfile {
  googleId: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(config: ConfigService) {
    super({
      clientID: config.getOrThrow<string>('GOOGLE_CLIENT_ID'),
      clientSecret: config.getOrThrow<string>('GOOGLE_CLIENT_SECRET'),
      callbackURL: config.getOrThrow<string>('GOOGLE_CALLBACK_URL'),
      scope: ['email', 'profile'],
    });
  }

  // Whatever is returned here becomes req.user
  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
  ): GoogleProfile {
    const email = profile.emails?.[0]?.value;
    const raw = profile._json as { email_verified?: boolean | string };
    if (!email) throw new Error('Google account has no email');

    return {
      googleId: profile.id,
      email: email.toLowerCase(),
      emailVerified:
        raw.email_verified === true || raw.email_verified === 'true',
      name: profile.displayName || email,
    };
  }
}
