import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Role } from '../roles/entities/role.entity';
import { AccountStatusService } from './services/account-status.service';
import { AdminAccountsService } from './services/admin-accounts.service';
import { AdminUsersController } from './controllers/admin-users.controller';
import { UserOtp } from './entities/user-otp.entity';
import { User } from './entities/user.entity';
import { OtpService } from './services/otp.service';
import { UsersController } from './controllers/users.controller';
import { UsersService } from './services/users.service';

/** Exports UsersService (NO_SHOW_COUNTER) and OtpService (TELEGRAM_LINK_CODES). */
@Module({
  // AuthModule: guard, AuthService and SessionsService.
  imports: [TypeOrmModule.forFeature([User, UserOtp, Role]), AuthModule],
  controllers: [UsersController, AdminUsersController],
  providers: [UsersService, OtpService, AccountStatusService, AdminAccountsService],
  exports: [UsersService, OtpService],
})
export class UsersModule {}
