import { Module } from '@nestjs/common';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule, JwtSignOptions } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { MailService } from './mail.service';
import { User } from '../users/entities/user.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { UserOtp } from '../users/entities/user-otp.entity';
import { authConfig } from '../configuration';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, RefreshToken, UserOtp]),
    // Secret and lifetime come from .env via authConfig; JWT_SECRET is
    JwtModule.registerAsync({
      // forFeature: works even where the root ConfigModule doesn't load authConfig (some tests).
      imports: [ConfigModule.forFeature(authConfig)],
      inject: [authConfig.KEY],
      useFactory: (auth: ConfigType<typeof authConfig>) => ({
        secret: auth.jwtSecret,
        signOptions: { expiresIn: toExpiresIn(auth.jwtAccessExpiresIn) },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, MailService],
  // JwtModule is re-exported so AuthGuard can resolve JwtService when used in importing modules.
  exports: [AuthService, AuthGuard, JwtModule],
})
export class AuthModule {}

// "900" means 900 seconds (jsonwebtoken reads a numeric string as ms otherwise);
function toExpiresIn(value: string): JwtSignOptions['expiresIn'] {
  return /^\d+$/.test(value)
    ? Number(value)
    : (value as JwtSignOptions['expiresIn']);
}
