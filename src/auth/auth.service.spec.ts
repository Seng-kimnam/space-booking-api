import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { OtpPurpose } from '../common/enums';
import { UserRole } from '../users/entities/user.entity';

describe('AuthService', () => {
  const user = {
    id: 'user-id',
    email: 'user@example.com',
    name: 'Test User',
    role: { name: UserRole.USER },
    emailVerifiedAt: new Date(),
    passwordHash: '',
  };

  it('creates an access and refresh token session', async () => {
    user.passwordHash = await bcrypt.hash('Password123!', 4);
    const refreshTokensRepository = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ ...value, id: 'refresh-id' })),
    };
    const service = new AuthService(
      { findOneBy: jest.fn().mockResolvedValue(user) } as never,
      refreshTokensRepository as never,
      {} as never,
      {} as never,
      { signAsync: jest.fn().mockResolvedValue('access-token') } as never,
      {} as never,
    );

    const result = await service.login(user.email, 'Password123!');

    expect(result.accessToken).toBe('access-token');
    expect(result.refreshToken).toEqual(expect.any(String));
    expect(result.user.email).toBe(user.email);
    expect(refreshTokensRepository.save).toHaveBeenCalled();
  });

  it('consumes a valid email verification OTP', async () => {
    const otp = '123456';
    const otpRecord = {
      id: 'otp-id',
      expiresAt: new Date(Date.now() + 60_000),
      attempts: 0,
      codeHash: await bcrypt.hash(otp, 4),
    };
    const usersRepository = {
      findOneBy: jest.fn().mockResolvedValue(user),
      update: jest.fn().mockResolvedValue(undefined),
    };
    const userOtpsRepository = {
      findOne: jest.fn().mockResolvedValue(otpRecord),
      update: jest.fn().mockResolvedValue(undefined),
      increment: jest.fn(),
    };
    const service = new AuthService(
      usersRepository as never,
      {} as never,
      userOtpsRepository as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.verifyEmail(user.email, otp),
    ).resolves.toEqual({ message: 'Email verified successfully' });
    expect(userOtpsRepository.update).toHaveBeenCalledWith(
      otpRecord.id,
      expect.objectContaining({ usedAt: expect.any(Date) }),
    );
    expect(usersRepository.update).toHaveBeenCalledWith(
      user.id,
      expect.objectContaining({ emailVerifiedAt: expect.any(Date) }),
    );
    expect(OtpPurpose.EMAIL_VERIFY).toBe('EMAIL_VERIFY');
  });

  it('revokes the refresh token and returns a logout message', async () => {
    const refreshTokensRepository = {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const service = new AuthService(
      {} as never,
      refreshTokensRepository as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(service.logout('refresh-token')).resolves.toEqual({
      message: 'Logout successful',
    });
    expect(refreshTokensRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ revokedAt: expect.anything() }),
      { revokedAt: expect.any(Date) },
    );
  });
});
