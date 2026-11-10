import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Param,
  UseGuards,
  UseInterceptors,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  RefreshTokenDto,
  RegisterDto,
  ResendOtpDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './dto/auth.dto';
import { AuthGuard } from './auth.guard';
import { CurrentUser } from './current-user.decorator';
import { Roles } from './role.decorator';
import { RolesInterceptor } from './roles.interceptor';
import { UserRole } from '../users/entities/user.entity';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { GoogleProfile } from './strategies/google.strategy';

type JwtUser = {
  sub: string;
};

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.registerUser(
      dto.email,
      dto.password,
      dto.name,
      dto.roleId,
    );
  }

  @Post('verify-email')
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto.email, dto.otp);
  }

  @Post('resend-otp')
  resendOtp(@Body() dto: ResendOtpDto) {
    return this.authService.resendOtp(dto.email);
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto.email, dto.password);
  }

  @Post('refresh-token')
  refreshToken(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
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

  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.email, dto.otp, dto.newPassword);
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Post('logout')
  logout(@Body() dto: RefreshTokenDto) {
    return this.authService.logout(dto.refreshToken);
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
    @Param('userId') userId: string,
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
    @Param('userId') userId: string,
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
