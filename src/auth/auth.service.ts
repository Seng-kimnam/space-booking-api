import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { IsNull, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import {
  AdminRequestStatus,
  User,
  UserRole,
} from '../users/entities/user.entity';
import { Role } from '../roles/entities/role.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { UserOtp } from '../users/entities/user-otp.entity';
import { OtpPurpose } from '../common/enums';
import { MailService } from './mail.service';

const OTP_TTL_MS = 10 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  emailVerifiedAt: Date | null;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(RefreshToken)
    private readonly refreshTokensRepository: Repository<RefreshToken>,
    @InjectRepository(UserOtp)
    private readonly userOtpsRepository: Repository<UserOtp>,
    @InjectRepository(Role)
    private readonly rolesRepository: Repository<Role>,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
  ) {}

  async registerUser(
    email: string,
    password: string,
    name: string,
    roleId: number,
  ) {
    const existing = await this.usersRepository.findOneBy({ email });
    if (existing) {
      throw new ConflictException('Email is already registered');
    }

    const role = await this.rolesRepository.findOneBy({ id: roleId });
    if (!role) {
      throw new ConflictException('Requested role is not configured');
    }

    if (role.name === UserRole.SUPER_ADMIN) {
      throw new ForbiddenException(
        'SUPER_ADMIN accounts can only be created by a SUPER_ADMIN',
      );
    }

    if (role.name !== UserRole.USER && role.name !== UserRole.ADMIN) {
      throw new ForbiddenException('This role cannot be used for registration');
    }

    const isAdminRequest = role.name === UserRole.ADMIN;
    const user = await this.usersRepository.save(
      this.usersRepository.create({
        email,
        passwordHash: await bcrypt.hash(password, 10),
        name,
        role,
        emailVerifiedAt: isAdminRequest ? new Date() : null,
        adminRequestStatus: isAdminRequest
          ? AdminRequestStatus.PENDING
          : null,
        adminRequestedAt: isAdminRequest ? new Date() : null,
        adminApprovedAt: null,
        adminApprovedById: null,
      }),
    );
    if (!isAdminRequest) {
      await this.issueOtp(user, OtpPurpose.EMAIL_VERIFY);
    }
    return {
      message: isAdminRequest
        ? 'Admin registration submitted for Super Admin approval.'
        : 'Registration successful. Check your email for the OTP.',
    };
  }

  async verifyEmail(email: string, otp: string): Promise<{ message: string }> {
    const user = await this.usersRepository.findOneBy({ email });
    if (!user) {
      throw new UnauthorizedException('Invalid OTP');
    }
    await this.consumeOtp(user, OtpPurpose.EMAIL_VERIFY, otp);
    await this.usersRepository.update(user.id, { emailVerifiedAt: new Date() });
    return { message: 'Email verified successfully' };
  }

  async resendOtp(email: string): Promise<{ message: string }> {
    const user = await this.usersRepository.findOneBy({ email });
    if (user && !user.emailVerifiedAt) {
      await this.issueOtp(user, OtpPurpose.EMAIL_VERIFY);
    }
    return { message: 'Email verification OTP  sent successfully.' };
  }

  async login(email: string, password: string) {
    const user = await this.usersRepository.findOneBy({ email });
    if (
      !user ||
      !user.passwordHash ||
      !(await bcrypt.compare(password, user.passwordHash))
    ) {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (!user.emailVerifiedAt) {
      throw new UnauthorizedException('Email address is not verified');
    }
    if (user.adminRequestStatus === AdminRequestStatus.PENDING) {
      throw new ForbiddenException('Admin registration is awaiting approval');
    }
    return this.issueSession(user);
  }

  async listAdminRequests(actorId: string): Promise<
    Array<{
      id: string;
      email: string;
      name: string;
      requestedAt: Date | null;
      status: AdminRequestStatus | null;
    }>
  > {
    await this.assertSuperAdmin(actorId);
    const users = await this.usersRepository.find({
      where: { adminRequestStatus: AdminRequestStatus.PENDING },
      order: { adminRequestedAt: 'ASC' },
    });
    return users.map((user) => this.toAdminRequestResponse(user));
  }

  async approveAdminRequest(
    actorId: string,
    userId: string,
  ): Promise<{ message: string }> {
    await this.assertSuperAdmin(actorId);
    const user = await this.findPendingAdminRequest(userId);
    const adminRole = await this.rolesRepository.findOneBy({
      name: UserRole.ADMIN,
    });
    if (!adminRole) {
      throw new ConflictException('Admin role is not configured');
    }

    await this.usersRepository.update(user.id, {
      role: adminRole,
      adminRequestStatus: AdminRequestStatus.APPROVED,
      adminApprovedAt: new Date(),
      adminApprovedById: actorId,
    });
    return { message: 'Admin registration approved successfully' };
  }

  async rejectAdminRequest(
    actorId: string,
    userId: string,
  ): Promise<{ message: string }> {
    await this.assertSuperAdmin(actorId);
    const user = await this.findPendingAdminRequest(userId);
    await this.usersRepository.update(user.id, {
      adminRequestStatus: AdminRequestStatus.REJECTED,
      adminApprovedAt: null,
      adminApprovedById: null,
    });
    return { message: 'Admin registration rejected successfully' };
  }

  async refresh(rawToken: string) {
    const tokenHash = this.hashToken(rawToken);
    const stored = await this.refreshTokensRepository.findOne({
      where: { tokenHash },
      relations: { user: true },
    });
    if (
      !stored ||
      stored.revokedAt ||
      stored.expiresAt <= new Date() ||
      !stored.user
    ) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const session = await this.issueSession(stored.user);
    const replacement = await this.refreshTokensRepository.findOneByOrFail({
      tokenHash: this.hashToken(session.refreshToken),
    });
    stored.revokedAt = new Date();
    stored.replacedById = replacement.id;
    await this.refreshTokensRepository.save(stored);
    return session;
  }

  async logout(rawToken: string): Promise<{ message: string }> {
    await this.refreshTokensRepository.update(
      { tokenHash: this.hashToken(rawToken), revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
    return { message: 'Logout successful' };
  }

  async getProfile(userId: string): Promise<AuthUser> {
    const user = await this.usersRepository.findOneBy({ id: userId });
    if (!user) {
      throw new UnauthorizedException();
    }
    return this.toAuthUser(user);
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.usersRepository.findOneBy({ id: userId });
    if (
      !user ||
      !user.passwordHash ||
      !(await bcrypt.compare(currentPassword, user.passwordHash))
    ) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    await this.usersRepository.update(user.id, {
      passwordHash: await bcrypt.hash(newPassword, 10),
    });
    await this.refreshTokensRepository.update(
      { userId: user.id, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  async forgotPassword(email: string): Promise<{ message: string }> {
    const user = await this.usersRepository.findOneBy({ email });
    if (user) {
      await this.issueOtp(user, OtpPurpose.PASSWORD_RESET);
    }
    return { message: 'A password reset OTP was successfully sent.' };
  }

  async resetPassword(
    email: string,
    otp: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    const user = await this.usersRepository.findOneBy({ email });
    if (!user) {
      throw new UnauthorizedException('Invalid OTP');
    }
    await this.consumeOtp(user, OtpPurpose.PASSWORD_RESET, otp);
    await this.usersRepository.update(user.id, {
      passwordHash: await bcrypt.hash(newPassword, 10),
    });
    await this.refreshTokensRepository.update(
      { userId: user.id, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
    return { message: 'Password reset successfully' };
  }

  toAuthUser(user: User): AuthUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role.name as UserRole,
      emailVerifiedAt: user.emailVerifiedAt,
    };
  }

  private async issueSession(user: User) {
    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
      role: user.role.name as UserRole,
    });
    const refreshToken = randomUUID() + randomUUID();
    await this.refreshTokensRepository.save(
      this.refreshTokensRepository.create({
        userId: user.id,
        tokenHash: this.hashToken(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
        revokedAt: null,
        replacedById: null,
        userAgent: null,
        ip: null,
      }),
    );
    return { accessToken, refreshToken, user: this.toAuthUser(user) };
  }

  private async issueOtp(user: User, purpose: OtpPurpose): Promise<void> {
    await this.userOtpsRepository.update(
      { userId: user.id, purpose, usedAt: IsNull() },
      { usedAt: new Date() },
    );
    const otp = randomInt(100000, 1000000).toString();
    await this.userOtpsRepository.save(
      this.userOtpsRepository.create({
        userId: user.id,
        purpose,
        codeHash: await bcrypt.hash(otp, 10),
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
        usedAt: null,
        attempts: 0,
        lastSentAt: new Date(),
      }),
    );
    await this.mailService.sendOtp(
      user.email,
      purpose === OtpPurpose.EMAIL_VERIFY ? 'EMAIL_VERIFY' : 'PASSWORD_RESET',
      otp,
    );
  }

  private async assertSuperAdmin(actorId: string): Promise<void> {
    const actor = await this.usersRepository.findOneBy({ id: actorId });
    if (!actor || actor.role.name !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('Super Admin access required');
    }
  }

  private async findPendingAdminRequest(userId: string): Promise<User> {
    const user = await this.usersRepository.findOneBy({ id: userId });
    if (
      !user ||
      user.adminRequestStatus !== AdminRequestStatus.PENDING
    ) {
      throw new NotFoundException('Pending admin registration not found');
    }
    return user;
  }

  private toAdminRequestResponse(user: User) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      requestedAt: user.adminRequestedAt,
      status: user.adminRequestStatus,
    };
  }

  private async consumeOtp(
    user: User,
    purpose: OtpPurpose,
    otp: string,
  ): Promise<void> {
    const record = await this.userOtpsRepository.findOne({
      where: { userId: user.id, purpose, usedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
    if (
      !record ||
      record.expiresAt <= new Date() ||
      record.attempts >= MAX_OTP_ATTEMPTS ||
      !(await bcrypt.compare(otp, record.codeHash))
    ) {
      if (record && record.attempts < MAX_OTP_ATTEMPTS) {
        await this.userOtpsRepository.increment(
          { id: record.id },
          'attempts',
          1,
        );
      }
      throw new UnauthorizedException('Invalid or expired OTP');
    }
    await this.userOtpsRepository.update(record.id, { usedAt: new Date() });
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
