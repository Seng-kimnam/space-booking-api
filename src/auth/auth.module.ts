import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { MailService } from './mail.service';
import { User } from '../users/entities/user.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { UserOtp } from '../users/entities/user-otp.entity';
import { Role } from '../roles/entities/role.entity';
import * as dotenv from 'dotenv';
import { GoogleStrategy } from './strategies/google.strategy';
dotenv.config();
@Module({
  imports: [
    TypeOrmModule.forFeature([User, RefreshToken, UserOtp, Role]),
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '15m' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, MailService, GoogleStrategy],
  // JwtModule is re-exported so AuthGuard can resolve JwtService when used in importing modules.
  exports: [AuthService, AuthGuard, JwtModule],
})
export class AuthModule {}
