import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { AccountStatusService } from './account-status.service';
import { AdminUsersController } from './admin-users.controller';
import { UserOtp } from './entities/user-otp.entity';
import { User } from './entities/user.entity';
import { OtpService } from './otp.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * Exports UsersService (NO_SHOW_COUNTER for bookings) and OtpService
 * (TELEGRAM_LINK_CODES for telegram); docs/project-structure.md section 2.
 */
@Module({
  // AuthGuard needs JwtService, which AuthModule re-exports; AccountStatusService
  // uses AuthService.revokeAllSessions.
  imports: [TypeOrmModule.forFeature([User, UserOtp]), AuthModule],
  controllers: [UsersController, AdminUsersController],
  providers: [UsersService, OtpService, AccountStatusService],
  exports: [UsersService, OtpService],
})
export class UsersModule {}
