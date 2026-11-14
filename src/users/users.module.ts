import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Role } from '../roles/entities/role.entity';
import { AccountStatusService } from './account-status.service';
import { AdminAccountsService } from './admin-accounts.service';
import { AdminUsersController } from './admin-users.controller';
import { UserOtp } from './entities/user-otp.entity';
import { User } from './entities/user.entity';
import { OtpService } from './otp.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * Exports UsersService (NO_SHOW_COUNTER for bookings) and OtpService
 * (TELEGRAM_LINK_CODES for telegram); docs/project-structure.md section 2.
 * Booking, notification and linked-account data arrive through the ports in
 * users.ports.ts (bound by BookingsBindingsModule and UsersBindingsModule).
 */
@Module({
  // AuthModule: AuthGuard (JwtService), AuthService (sessions, password
  // confirmation, email change, set-password code) and SessionsService.
  imports: [TypeOrmModule.forFeature([User, UserOtp, Role]), AuthModule],
  controllers: [UsersController, AdminUsersController],
  providers: [UsersService, OtpService, AccountStatusService, AdminAccountsService],
  exports: [UsersService, OtpService],
})
export class UsersModule {}
