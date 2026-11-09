import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
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
import {
  AuthSessionResponseDto,
  AuthUserResponseDto,
  MessageResponseDto,
} from './dto/auth-response.dto';
import { AuthGuard } from './auth.guard';
import { CurrentUser } from './current-user.decorator';
import { Roles } from './role.decorator';
import { RolesInterceptor } from './roles.interceptor';
import { UserRole } from '../common/enums';

type JwtUser = {
  sub: string;
};

// Every body is validated by the global ValidationPipe (main.ts), so each
// endpoint that takes one can answer 400.
@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Register an account; sends an email OTP' })
  @ApiCreatedResponse({ type: MessageResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid email, password or name' })
  @ApiConflictResponse({ description: 'Email is already registered' })
  register(@Body() dto: RegisterDto): Promise<MessageResponseDto> {
    return this.authService.registerUser(dto.email, dto.password, dto.name);
  }

  @Post('verify-email')
  @ApiOperation({ summary: 'Verify the email address with the OTP' })
  @ApiCreatedResponse({ type: MessageResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid body' })
  @ApiUnauthorizedResponse({ description: 'Invalid or expired OTP' })
  verifyEmail(@Body() dto: VerifyEmailDto): Promise<MessageResponseDto> {
    return this.authService.verifyEmail(dto.email, dto.otp);
  }

  @Post('resend-otp')
  @ApiOperation({
    summary: 'Resend the verification OTP',
    description: 'Same response whether or not the email exists.',
  })
  @ApiCreatedResponse({ type: MessageResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid email' })
  resendOtp(@Body() dto: ResendOtpDto): Promise<MessageResponseDto> {
    return this.authService.resendOtp(dto.email);
  }

  @Post('login')
  @ApiOperation({ summary: 'Log in with email and password' })
  @ApiCreatedResponse({ type: AuthSessionResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid body' })
  @ApiUnauthorizedResponse({
    description: 'Wrong email or password, or email not verified',
  })
  login(@Body() dto: LoginDto): Promise<AuthSessionResponseDto> {
    return this.authService.login(dto.email, dto.password);
  }

  @Post('refresh-token')
  @ApiOperation({
    summary: 'Exchange a refresh token for a new session',
    description:
      'The refresh token sent is revoked; use the new one next time.',
  })
  @ApiCreatedResponse({ type: AuthSessionResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid body' })
  @ApiUnauthorizedResponse({
    description: 'Refresh token unknown, revoked or expired',
  })
  refreshToken(@Body() dto: RefreshTokenDto): Promise<AuthSessionResponseDto> {
    return this.authService.refresh(dto.refreshToken);
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Get('me')
  @ApiOperation({ summary: 'Current user profile' })
  @ApiOkResponse({ type: AuthUserResponseDto })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  me(@CurrentUser() user: JwtUser): Promise<AuthUserResponseDto> {
    return this.authService.getProfile(user.sub);
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Patch('change-password')
  @ApiOperation({
    summary: 'Change password',
    description: 'Revokes all of the user’s refresh tokens.',
  })
  @ApiOkResponse({ type: MessageResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid body' })
  @ApiUnauthorizedResponse({
    description: 'Missing/invalid access token, or current password wrong',
  })
  async changePassword(
    @CurrentUser() user: JwtUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<MessageResponseDto> {
    await this.authService.changePassword(
      user.sub,
      dto.currentPassword,
      dto.newPassword,
    );
    return { message: 'Password changed successfully' };
  }

  @Post('forgot-password')
  @ApiOperation({
    summary: 'Send a password reset OTP',
    description: 'Same response whether or not the email exists.',
  })
  @ApiCreatedResponse({ type: MessageResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid email' })
  forgotPassword(@Body() dto: ForgotPasswordDto): Promise<MessageResponseDto> {
    return this.authService.forgotPassword(dto.email);
  }

  @Post('reset-password')
  @ApiOperation({
    summary: 'Reset the password with the OTP',
    description: 'Revokes all of the user’s refresh tokens.',
  })
  @ApiCreatedResponse({ type: MessageResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid body' })
  @ApiUnauthorizedResponse({ description: 'Invalid or expired OTP' })
  resetPassword(@Body() dto: ResetPasswordDto): Promise<MessageResponseDto> {
    return this.authService.resetPassword(dto.email, dto.otp, dto.newPassword);
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Post('logout')
  @ApiOperation({ summary: 'Log out: revoke the given refresh token' })
  @ApiCreatedResponse({ description: 'Refresh token revoked (empty body)' })
  @ApiBadRequestResponse({ description: 'Invalid body' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  logout(@Body() dto: RefreshTokenDto): Promise<void> {
    return this.authService.logout(dto.refreshToken);
  }

  // SECURITY (not changed here; auth logic is out of scope for this PR):
  // this route is public, so anyone can create an ADMIN, and it returns the
  // raw User entity including password_hash. Remove it or guard it with
  // AuthGuard + RolesGuard + @Roles(ADMIN) and return toAuthUser().
  @Post('admin/register')
  @ApiOperation({ summary: 'Create an ADMIN account' })
  @ApiCreatedResponse({ description: 'The created user' })
  @ApiBadRequestResponse({ description: 'Invalid email, password or name' })
  @ApiConflictResponse({ description: 'Email is already registered' })
  registerAdmin(@Body() dto: RegisterDto) {
    return this.authService.createAdminUser(dto.email, dto.password, dto.name);
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @UseInterceptors(RolesInterceptor)
  @Roles(UserRole.ADMIN)
  @Get('admin-only')
  @ApiOperation({ summary: 'Check that the caller is an ADMIN' })
  @ApiOkResponse({ type: MessageResponseDto })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({ description: 'Caller is not an ADMIN' })
  adminOnly(): MessageResponseDto {
    return { message: 'Admin access granted' };
  }
}
