import { ApiProperty } from '@nestjs/swagger';
import {
  IsByteLength,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

// bcrypt only uses the first 72 bytes of a password and silently ignores the
// rest, so a longer new password would not mean what the user thinks. Bytes,
// not characters: one emoji is 4 bytes. Applied where a password is SET, not
// on login, so nobody with an older long password is locked out.
const PASSWORD_MAX_BYTES = 72;
const passwordBytes = () =>
  IsByteLength(0, PASSWORD_MAX_BYTES, {
    message: `$property must be at most ${PASSWORD_MAX_BYTES} bytes`,
  });

export class RegisterDto {
  @ApiProperty({
    example: 'john@example.com',
    description: 'User email address',
  })
  @IsEmail()
  email: string;

  @ApiProperty({
    example: 'Password123!',
    minLength: 8,
    description: 'At most 72 bytes (bcrypt limit).',
  })
  @IsString()
  @MinLength(8)
  @passwordBytes()
  password: string;

  @ApiProperty({
    example: 'John Doe',
    maxLength: 100,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({
    example: 3,
    description:
      'Role ID. USER registers normally; ADMIN requires SUPER_ADMIN approval.',
  })
  @IsInt()
  @Min(1)
  roleId: number;
}

export class LoginDto {
  @ApiProperty({
    example: 'john@example.com',
  })
  @IsEmail()
  email: string;

  @ApiProperty({
    example: 'Password123!',
  })
  @IsString()
  @MinLength(8)
  password: string;
}

export class VerifyEmailDto {
  @IsEmail()
  @ApiProperty({
    example: 'john@example.com',
    description: 'User email address',
  })
  email: string;

  @IsString()
  @IsNotEmpty()
  @ApiProperty({
    example: '123456',
    description: 'OTP sent to the user email for verification',
  })
  otp: string;
}

export class ResendOtpDto {
  @ApiProperty({
    example: 'john@example.com',
    description: 'User email address',
  })
  @IsEmail()
  email: string;
}

export class RefreshTokenDto {
  @ApiProperty({
    example: 'refresh-token-value',
    description: 'Refresh token returned by login',
  })
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}

export class ChangePasswordDto {
  @ApiProperty({
    example: 'CurrentPassword123!',
    minLength: 8,
  })
  @IsString()
  @MinLength(8)
  currentPassword: string;

  @ApiProperty({
    example: 'NewPassword123!',
    minLength: 8,
  })
  @IsString()
  @MinLength(8)
  @passwordBytes()
  newPassword: string;
}

export class ForgotPasswordDto {
  @ApiProperty({
    example: 'john@example.com',
    description: 'User email address',
  })
  @IsEmail()
  email: string;
}

export class ResetPasswordDto {
  @ApiProperty({
    example: 'john@example.com',
    description: 'User email address',
  })
  @IsEmail()
  email: string;

  @ApiProperty({
    example: '123456',
    description: 'OTP sent to the user email',
  })
  @IsString()
  @IsNotEmpty()
  otp: string;

  @ApiProperty({
    example: 'NewPassword123!',
    minLength: 8,
  })
  @IsString()
  @MinLength(8)
  @passwordBytes()
  newPassword: string;
}
