import {
  Body,
  Controller,
  Get,
  Headers,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
  UseInterceptors,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { AuthService } from '../services/auth.service';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  RefreshTokenDto,
  RegisterDto,
  ResendOtpDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from '../dto/auth.dto';
import { AuthGuard } from '../guards/auth.guard';
import {
  AuthThrottle,
  LOGIN_LIMITS,
  OTP_CHECK_LIMITS,
  OTP_SEND_LIMITS,
  REFRESH_LIMITS,
} from '../config/auth-throttle';
import { CurrentUser } from '../decorators/current-user.decorator';
import { Roles } from '../decorators/role.decorator';
import { RolesInterceptor } from '../interceptors/roles.interceptor';
import { UserRole } from '../../users/entities/user.entity';
import { GoogleAuthGuard } from '../guards/google-auth.guard';
import { GoogleProfile } from '../strategies/google.strategy';

type JwtUser = {
  sub: string;
};

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @AuthThrottle(OTP_SEND_LIMITS)
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.registerUser(
      dto.email,
      dto.password,
      dto.name,
      dto.roleId,
    );
  }

  @AuthThrottle(OTP_CHECK_LIMITS)
  @Post('verify-email')
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto.email, dto.otp);
  }

  @AuthThrottle(OTP_SEND_LIMITS)
  @Post('resend-otp')
  resendOtp(@Body() dto: ResendOtpDto) {
    return this.authService.resendOtp(dto.email);
  }

  @AuthThrottle(LOGIN_LIMITS)
  @Post('login')
  login(
    @Body() dto: LoginDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.authService.login(dto.email, dto.password, { ip, userAgent });
  }

  @AuthThrottle(REFRESH_LIMITS)
  @Post('refresh-token')
  refreshToken(
    @Body() dto: RefreshTokenDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.authService.refresh(dto.refreshToken, { ip, userAgent });
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Get('me')
  me(@CurrentUser() user: JwtUser) {
    return this.authService.getProfile(user.sub);
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Patch('change-password')
  async changePassword(
    @CurrentUser() user: JwtUser,
    @Body() dto: ChangePasswordDto,
  ) {
    await this.authService.changePassword(
      user.sub,
      dto.currentPassword,
      dto.newPassword,
    );
    return { message: 'Password changed successfully' };
  }

  @AuthThrottle(OTP_SEND_LIMITS)
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  @AuthThrottle(OTP_CHECK_LIMITS)
  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.email, dto.otp, dto.newPassword);
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Post('logout')
  logout(@CurrentUser() user: JwtUser, @Body() dto: RefreshTokenDto) {
    return this.authService.logout(user.sub, dto.refreshToken);
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Post('logout-all')
  logoutAll(@CurrentUser() user: JwtUser) {
    return this.authService.logoutAll(user.sub);
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @UseInterceptors(RolesInterceptor)
  @Roles(UserRole.SUPER_ADMIN)
  @Get('admin-requests')
  listAdminRequests(@CurrentUser() user: JwtUser) {
    return this.authService.listAdminRequests(user.sub);
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @UseInterceptors(RolesInterceptor)
  @Roles(UserRole.SUPER_ADMIN)
  @Post('admin-requests/:userId/approve')
  approveAdminRequest(
    @CurrentUser() user: JwtUser,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.authService.approveAdminRequest(user.sub, userId);
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @UseInterceptors(RolesInterceptor)
  @Roles(UserRole.SUPER_ADMIN)
  @Post('admin-requests/:userId/reject')
  rejectAdminRequest(
    @CurrentUser() user: JwtUser,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.authService.rejectAdminRequest(user.sub, userId);
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @UseInterceptors(RolesInterceptor)
  @Roles(UserRole.ADMIN)
  @Get('admin-only')
  adminOnly() {
    return { message: 'Admin access granted' };
  }

  // Step 1: redirects the browser to Google's consent screen
  @Get('google')
  @UseGuards(GoogleAuthGuard)
  @ApiExcludeEndpoint()
  googleLogin() {
    return { message: 'Redirecting to Google for authentication...' };
  }

  // Step 2: Google redirects back here with a code
  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  @ApiExcludeEndpoint()
  googleCallback(@Req() req: { user: GoogleProfile }) {
    return this.authService.loginWithGoogle(req.user);
  }
}
