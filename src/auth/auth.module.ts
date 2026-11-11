import { Module } from '@nestjs/common';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { AdminUsersController } from './admin-users.controller';
import { AUTH_THROTTLERS } from './auth-throttle';
import { AuthService } from './auth.service';
import { AccountStatusService } from './account-status.service';
import { AuthCleanupService } from './auth-cleanup.service';
import { AuthGuard } from './auth.guard';
import { MailService } from './mail.service';
import { jwtModuleOptions } from './jwt-options';
import { authConfig } from '../configuration/auth.config';
import { mailConfig } from '../configuration/mail.config';
import { User } from '../users/entities/user.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { UserOtp } from '../users/entities/user-otp.entity';
import { Role } from '../roles/entities/role.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, RefreshToken, UserOtp, Role]),
    // MailService reads mail.*: loaded here so AuthModule works in any host
    // module, including test modules that don't load every config.
    ConfigModule.forFeature(mailConfig),
    // From authConfig (validated env), not process.env: honours
    // JWT_ACCESS_EXPIRES_IN and pins HS256 + issuer/audience (jwt-options.ts).
    JwtModule.registerAsync({
      // forFeature: AuthModule brings its own config, so it also works in
      // test modules that don't load every config (e.g. the bookings e2e).
      imports: [ConfigModule.forFeature(authConfig)],
      inject: [authConfig.KEY],
      useFactory: (auth: ConfigType<typeof authConfig>) =>
        jwtModuleOptions(auth),
    }),
    // Rate limits for the public /auth routes. Not a global guard: only routes
    // marked @AuthThrottle(...) in AuthController are throttled.
    ThrottlerModule.forRoot({ throttlers: AUTH_THROTTLERS }),
  ],
  controllers: [AuthController, AdminUsersController],
  providers: [
    AuthService,
    AccountStatusService,
    AuthCleanupService,
    AuthGuard,
    MailService,
  ],
  // JwtModule is re-exported so AuthGuard can resolve JwtService when used in importing modules.
  exports: [AuthService, AuthCleanupService, AuthGuard, JwtModule],
})
export class AuthModule {}
