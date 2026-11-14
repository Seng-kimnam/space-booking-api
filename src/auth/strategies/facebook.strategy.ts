import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy } from 'passport-facebook';

export interface FacebookProfile {
  facebookId: string;
  // Facebook can omit the email (phone sign-up, or the user declined it).
  email: string | null;
  name: string;
  avatarUrl: string | null;
}

@Injectable()
export class FacebookStrategy extends PassportStrategy(Strategy, 'facebook') {
  constructor(config: ConfigService) {
    super({
      clientID: config.getOrThrow<string>('FACEBOOK_APP_ID'),
      clientSecret: config.getOrThrow<string>('FACEBOOK_APP_SECRET'),
      callbackURL: config.getOrThrow<string>('FACEBOOK_CALLBACK_URL'),
      scope: ['email', 'public_profile'],
      profileFields: ['id', 'displayName', 'emails', 'photos'],
      // Signs Graph API calls with our app secret (appsecret_proof).
      enableProof: true,
    });
  }

  // Whatever is returned here becomes req.user.
  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
  ): FacebookProfile {
    const email = profile.emails?.[0]?.value?.toLowerCase() ?? null;
    return {
      facebookId: profile.id,
      email,
      name: (profile.displayName || email || 'Facebook user').slice(0, 100),
      avatarUrl: profile.photos?.[0]?.value?.slice(0, 500) ?? null,
    };
  }
}
