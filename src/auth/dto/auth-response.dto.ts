import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '../../common/enums';

// Swagger shapes of what AuthService returns. They describe the existing
// responses exactly; they don't change them.

export class MessageResponseDto {
  @ApiProperty({ example: 'Email verified successfully' })
  message: string;
}

export class AuthUserResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'john@example.com' })
  email: string;

  @ApiProperty({ example: 'John Doe' })
  name: string;

  @ApiProperty({ enum: UserRole, example: UserRole.USER })
  role: UserRole;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  emailVerifiedAt: Date | null;
}

export class AuthSessionResponseDto {
  @ApiProperty({ description: 'JWT access token (Authorization: Bearer ...)' })
  accessToken: string;

  @ApiProperty({
    description:
      'Opaque refresh token for POST /auth/refresh-token. Single use: each refresh returns a new one.',
  })
  refreshToken: string;

  @ApiProperty({ type: AuthUserResponseDto })
  user: AuthUserResponseDto;
}
