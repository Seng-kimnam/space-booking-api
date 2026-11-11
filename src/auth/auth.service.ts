import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import {
  DataSource,
  EntityManager,
  IsNull,
  Not,
  Repository,
  UpdateResult,
} from 'typeorm';
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
import { isPgError, PG_UNIQUE_VIOLATION } from '../common/utils/db-errors';

const OTP_TTL_MS = 10 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const BCRYPT_COST = 10;
export const MAX_OTP_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
// A rotated token presented again within this window is treated as a client
// race (two tabs, a retry), not theft: plain 401, other sessions kept.
export const REFRESH_REUSE_GRACE_MS = 10 * 1000;

// One message per outcome, whatever the cause, so responses never reveal
// whether an email has an account (AGENTS.md section 6.8, docs/auth.md M4).
export const INVALID_OTP = 'Invalid or expired OTP';
export const INVALID_CREDENTIALS = 'Invalid email or password';
export const INVALID_REFRESH = 'Invalid refresh token';
export const REGISTER_MESSAGE =
  'Registration received. Check your email for the verification code.';
export const ADMIN_REGISTER_MESSAGE =
  'Registration received. Verify your email; a Super Admin will then review the admin request.';
export const RESEND_MESSAGE =
  'If the account needs verification, a new code has been sent.';
export const FORGOT_MESSAGE =
  'If an account exists for this email, a password reset code has been sent.';

/** Rows from `UPDATE ... RETURNING` (query builder puts them in `.raw`). */
function rowsOf<T = unknown>(result: UpdateResult): T[] {
  return Array.isArray(result.raw) ? (result.raw as T[]) : [];
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  emailVerifiedAt: Date | null;
}

/** Where a session was opened from; stored on the refresh token. */
export interface SessionMeta {
  userAgent?: string | null;
  ip?: string | null;
}

@Injectable()
export class AuthService {
  // Audit trail of auth events. Ids and outcomes only: never emails, tokens,
  // OTPs or passwords (AGENTS.md section 9, checked by common/logging.spec.ts).
  private readonly logger = new Logger(AuthService.name);
  // Hash compared against when the account doesn't exist, so a wrong email
  // costs the same bcrypt time as a wrong password (no timing enumeration).
  private dummyHash?: Promise<string>;

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
    private readonly dataSource: DataSource,
  ) {}

  async registerUser(
    email: string,
    password: string,
    name: string,
    roleId: number,
  ): Promise<{ message: string }> {
    // Role checks come first: they depend on the input, not on whether the
    // email exists, so they reveal nothing about accounts.
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
    const message = isAdminRequest ? ADMIN_REGISTER_MESSAGE : REGISTER_MESSAGE;

    // An admin request is stored as a USER; only approveAdminRequest grants
    // ADMIN (docs/auth.md C1).
    const userRole = isAdminRequest
      ? await this.rolesRepository.findOneBy({ name: UserRole.USER })
      : role;
    if (!userRole) {
      throw new ConflictException('User role is not configured');
    }

    // Hashed before the existence check so both paths cost the same.
    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    const existing = await this.usersRepository.findOneBy({ email });
    if (existing) {
      // Same response as a new registration (docs/auth.md M4). An unverified
      // owner gets a fresh code (cooldown applies); nothing else changes.
      if (!existing.emailVerifiedAt) {
        await this.issueOtp(existing, OtpPurpose.EMAIL_VERIFY);
      }
      return { message };
    }

    let user: User;
    try {
      user = await this.usersRepository.save(
        this.usersRepository.create({
          email,
          passwordHash,
          name,
          role: userRole,
          // Admin requests verify their email like everyone else (docs/auth.md M2).
          emailVerifiedAt: null,
          isActive: true,
          adminRequestStatus: isAdminRequest ? AdminRequestStatus.PENDING : null,
          adminRequestedAt: isAdminRequest ? new Date() : null,
          adminApprovedAt: null,
          adminApprovedById: null,
        }),
      );
    } catch (err) {
      // A concurrent registration with the same email won the unique index.
      if (isPgError(err, PG_UNIQUE_VIOLATION, 'users_email_uk')) {
        return { message };
      }
      throw err;
    }
    await this.issueOtp(user, OtpPurpose.EMAIL_VERIFY);
    this.logger.log(
      `User registered: user=${user.id} adminRequest=${isAdminRequest}`,
    );
    return { message };
  }

  async verifyEmail(email: string, otp: string): Promise<{ message: string }> {
    const user = await this.usersRepository.findOneBy({ email });
    if (!user) {
      await this.burnHashTime(otp);
      throw new UnauthorizedException(INVALID_OTP);
    }
    const otpId = await this.checkOtp(user, OtpPurpose.EMAIL_VERIFY, otp);
    await this.dataSource.transaction(async (manager) => {
      await this.markOtpUsed(manager, otpId);
      await manager
        .getRepository(User)
        .update(user.id, { emailVerifiedAt: new Date() });
    });
    this.logger.log(`Email verified: user=${user.id}`);
    return { message: 'Email verified successfully' };
  }

  async resendOtp(email: string): Promise<{ message: string }> {
    const user = await this.usersRepository.findOneBy({ email });
    if (user && !user.emailVerifiedAt) {
      await this.issueOtp(user, OtpPurpose.EMAIL_VERIFY);
    } else {
      await this.burnHashTime(email);
    }
    return { message: RESEND_MESSAGE };
  }

  async login(email: string, password: string, meta: SessionMeta = {}) {
    const user = await this.usersRepository.findOneBy({ email });
    const passwordOk = user?.passwordHash
      ? await bcrypt.compare(password, user.passwordHash)
      : await this.burnHashTime(password);
    if (!user || !passwordOk) {
      this.logger.warn(`Login failed: user=${user?.id ?? 'unknown'}`);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    // These only show after a correct password, so they reveal nothing new.
    if (!user.emailVerifiedAt) {
      throw new UnauthorizedException('Email address is not verified');
    }
    if (!user.isActive) {
      this.logger.warn(`Login refused, account suspended: user=${user.id}`);
      throw new ForbiddenException('Account is suspended');
    }
    if (user.adminRequestStatus === AdminRequestStatus.PENDING) {
      throw new ForbiddenException('Admin registration is awaiting approval');
    }
    const { session } = await this.issueSession(
      this.dataSource.manager,
      user,
      meta,
    );
    this.logger.log(`Login succeeded: user=${user.id}`);
    return session;
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
    // Only verified requests: nobody approves an address no one has proven to own.
    const users = await this.usersRepository.find({
      where: {
        adminRequestStatus: AdminRequestStatus.PENDING,
        emailVerifiedAt: Not(IsNull()),
      },
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
    // Conditional on still PENDING, so a concurrent reject can't be overwritten.
    const result = await this.usersRepository.update(
      { id: user.id, adminRequestStatus: AdminRequestStatus.PENDING },
      {
        role: adminRole,
        adminRequestStatus: AdminRequestStatus.APPROVED,
        adminApprovedAt: new Date(),
        adminApprovedById: actorId,
      },
    );
    if (!result.affected) {
      throw new NotFoundException('Pending admin registration not found');
    }
    this.logger.log(`Admin request approved: user=${user.id} by=${actorId}`);
    return { message: 'Admin registration approved successfully' };
  }

  async rejectAdminRequest(
    actorId: string,
    userId: string,
  ): Promise<{ message: string }> {
    await this.assertSuperAdmin(actorId);
    const user = await this.findPendingAdminRequest(userId);
    const result = await this.usersRepository.update(
      { id: user.id, adminRequestStatus: AdminRequestStatus.PENDING },
      {
        adminRequestStatus: AdminRequestStatus.REJECTED,
        adminApprovedAt: null,
        adminApprovedById: null,
      },
    );
    if (!result.affected) {
      throw new NotFoundException('Pending admin registration not found');
    }
    // The users row keeps no "rejected by"; this log line is the record.
    this.logger.log(`Admin request rejected: user=${user.id} by=${actorId}`);
    return { message: 'Admin registration rejected successfully' };
  }

  /**
   * Rotates a refresh token (docs/auth.md M1). The old token is revoked with a
   * conditional UPDATE, so of two parallel calls with the same token exactly
   * one wins. Presenting a token that was already rotated means it leaked (or
   * a client replayed it): every token of that user is revoked.
   */
  async refresh(rawToken: string, meta: SessionMeta = {}) {
    const tokenHash = this.hashToken(rawToken);
    const session = await this.dataSource.transaction(async (manager) => {
      const revoked = await manager
        .getRepository(RefreshToken)
        .createQueryBuilder()
        .update()
        .set({ revokedAt: () => 'now()' })
        .where(
          'token_hash = :tokenHash AND revoked_at IS NULL AND expires_at > now()',
          { tokenHash },
        )
        // String form = raw column names (the array form maps entity
        // properties and drops `user_id`).
        .returning('id, user_id')
        .execute();
      const row = rowsOf<{ id: string; user_id: string }>(revoked)[0];
      if (!row) return null;

      const user = await manager
        .getRepository(User)
        .findOneBy({ id: row.user_id });
      if (!user || !this.canHoldSession(user)) {
        // Throwing rolls the revoke back; the token stays unusable anyway
        // until the account is usable again.
        throw new UnauthorizedException(INVALID_REFRESH);
      }
      const next = await this.issueSession(manager, user, meta);
      await manager
        .getRepository(RefreshToken)
        .update(row.id, { replacedById: next.tokenId });
      return next.session;
    });

    if (!session) {
      await this.handleUnusableRefresh(tokenHash);
      throw new UnauthorizedException(INVALID_REFRESH);
    }
    return session;
  }

  /** Revokes the caller's own refresh token; someone else's is left alone. */
  async logout(userId: string, rawToken: string): Promise<{ message: string }> {
    await this.refreshTokensRepository.update(
      { tokenHash: this.hashToken(rawToken), userId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
    return { message: 'Logout successful' };
  }

  /** Revokes every refresh token of the caller (log out on all devices). */
  async logoutAll(userId: string): Promise<{ message: string }> {
    const revoked = await this.revokeAllSessions(
      this.dataSource.manager,
      userId,
    );
    this.logger.log(`Logged out everywhere: user=${userId} sessions=${revoked}`);
    return { message: 'Logged out on all devices' };
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
      this.logger.warn(`Password change refused: user=${userId}`);
      throw new UnauthorizedException('Current password is incorrect');
    }
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
    // New hash and signing out everywhere succeed or fail together.
    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(User).update(user.id, { passwordHash });
      await this.revokeAllSessions(manager, user.id);
    });
    this.logger.log(`Password changed: user=${user.id}`);
    this.notifyPasswordChanged(user);
  }

  async forgotPassword(email: string): Promise<{ message: string }> {
    const user = await this.usersRepository.findOneBy({ email });
    if (user) {
      await this.issueOtp(user, OtpPurpose.PASSWORD_RESET);
    } else {
      await this.burnHashTime(email);
    }
    return { message: FORGOT_MESSAGE };
  }

  async resetPassword(
    email: string,
    otp: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    const user = await this.usersRepository.findOneBy({ email });
    if (!user) {
      await this.burnHashTime(otp);
      throw new UnauthorizedException(INVALID_OTP);
    }
    const otpId = await this.checkOtp(user, OtpPurpose.PASSWORD_RESET, otp);
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
    // Code consumed, password replaced and every session revoked: all or nothing.
    await this.dataSource.transaction(async (manager) => {
      await this.markOtpUsed(manager, otpId);
      await manager.getRepository(User).update(user.id, { passwordHash });
      await this.revokeAllSessions(manager, user.id);
    });
    this.logger.log(`Password reset: user=${user.id}`);
    this.notifyPasswordChanged(user);
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

  /** Revokes all live refresh tokens of a user; returns how many. */
  async revokeAllSessions(
    manager: EntityManager,
    userId: string,
  ): Promise<number> {
    const result = await manager
      .getRepository(RefreshToken)
      .update({ userId, revokedAt: IsNull() }, { revokedAt: new Date() });
    return result.affected ?? 0;
  }

  /** Who may get new tokens: verified, active, and not waiting for approval. */
  private canHoldSession(user: User): boolean {
    return (
      !!user.emailVerifiedAt &&
      user.isActive &&
      user.adminRequestStatus !== AdminRequestStatus.PENDING
    );
  }

  private async handleUnusableRefresh(tokenHash: string): Promise<void> {
    const stored = await this.refreshTokensRepository.findOneBy({ tokenHash });
    // Rotated a while ago: someone is replaying an old token. Rotated just
    // now (grace window), revoked by logout, expired, or unknown: just refuse.
    const rotatedAt = stored?.revokedAt?.getTime() ?? Date.now();
    if (
      stored?.replacedById &&
      Date.now() - rotatedAt > REFRESH_REUSE_GRACE_MS
    ) {
      const revoked = await this.revokeAllSessions(
        this.dataSource.manager,
        stored.userId,
      );
      this.logger.warn(
        `Refresh token reuse detected: user=${stored.userId} token=${stored.id} revokedSessions=${revoked}`,
      );
    }
  }

  private async issueSession(
    manager: EntityManager,
    user: User,
    meta: SessionMeta,
  ) {
    // No email in the payload: a JWT is readable by anyone holding it.
    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      role: user.role.name as UserRole,
    });
    const refreshToken = randomUUID() + randomUUID();
    const tokens = manager.getRepository(RefreshToken);
    const saved = await tokens.save(
      tokens.create({
        userId: user.id,
        tokenHash: this.hashToken(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
        revokedAt: null,
        replacedById: null,
        userAgent: meta.userAgent?.slice(0, 255) || null,
        ip: meta.ip || null,
      }),
    );
    return {
      session: { accessToken, refreshToken, user: this.toAuthUser(user) },
      // Internal (rotation chain), never part of the response.
      tokenId: saved.id,
    };
  }

  private async issueOtp(user: User, purpose: OtpPurpose): Promise<void> {
    // Resend cooldown: a code sent less than a minute ago is still live, so
    // don't mail another. Callers return the same generic message either way.
    const live = await this.userOtpsRepository.findOne({
      where: { userId: user.id, purpose, usedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
    if (
      live &&
      live.expiresAt > new Date() &&
      Date.now() - live.lastSentAt.getTime() < OTP_RESEND_COOLDOWN_MS
    ) {
      await this.burnHashTime(user.id);
      return;
    }

    await this.userOtpsRepository.update(
      { userId: user.id, purpose, usedAt: IsNull() },
      { usedAt: new Date() },
    );
    const otp = randomInt(100000, 1000000).toString();
    try {
      await this.userOtpsRepository.save(
        this.userOtpsRepository.create({
          userId: user.id,
          purpose,
          codeHash: await bcrypt.hash(otp, BCRYPT_COST),
          expiresAt: new Date(Date.now() + OTP_TTL_MS),
          usedAt: null,
          attempts: 0,
          lastSentAt: new Date(),
        }),
      );
    } catch (err) {
      // A concurrent request just issued the live code (user_otps_live_uk
      // allows one per user and purpose). Theirs gets mailed; this one is a no-op.
      if (isPgError(err, PG_UNIQUE_VIOLATION, 'user_otps_live_uk')) return;
      throw err;
    }
    // Not awaited: the response must not depend on SMTP (timing, or a 500
    // only for existing accounts). MailService logs failures; the user can
    // ask for a new code after the cooldown.
    this.mailService
      .sendOtp(
        user.email,
        purpose === OtpPurpose.EMAIL_VERIFY ? 'EMAIL_VERIFY' : 'PASSWORD_RESET',
        otp,
      )
      .catch(() => undefined);
  }

  private notifyPasswordChanged(user: User): void {
    // Fire and forget, like OTP mail; MailService logs a failure.
    this.mailService.sendPasswordChanged(user.email).catch(() => undefined);
  }

  /**
   * Checks a code and counts the attempt (docs/auth.md H1). The attempt is
   * reserved with a conditional UPDATE BEFORE the slow bcrypt compare and
   * commits on its own, so parallel guesses can't exceed MAX_OTP_ATTEMPTS and
   * a wrong guess is never rolled back. Returns the code's id; the caller
   * marks it used inside its own transaction (markOtpUsed).
   */
  private async checkOtp(
    user: User,
    purpose: OtpPurpose,
    otp: string,
  ): Promise<string> {
    const record = await this.userOtpsRepository.findOne({
      where: { userId: user.id, purpose, usedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
    if (!record) {
      await this.burnHashTime(otp);
      throw new UnauthorizedException(INVALID_OTP);
    }

    const reserved = await this.userOtpsRepository
      .createQueryBuilder()
      .update()
      .set({ attempts: () => 'attempts + 1' })
      .where(
        'id = :id AND attempts < :max AND used_at IS NULL AND expires_at > now()',
        { id: record.id, max: MAX_OTP_ATTEMPTS },
      )
      .returning('id')
      .execute();
    if (!rowsOf(reserved).length) {
      throw new UnauthorizedException(INVALID_OTP);
    }
    if (!(await bcrypt.compare(otp, record.codeHash))) {
      this.logger.warn(`Wrong OTP: user=${user.id} purpose=${purpose}`);
      throw new UnauthorizedException(INVALID_OTP);
    }
    return record.id;
  }

  /** Single use: only one concurrent request can flip used_at. */
  private async markOtpUsed(
    manager: EntityManager,
    otpId: string,
  ): Promise<void> {
    const consumed = await manager
      .getRepository(UserOtp)
      .createQueryBuilder()
      .update()
      .set({ usedAt: () => 'now()' })
      .where('id = :id AND used_at IS NULL', { id: otpId })
      .returning('id')
      .execute();
    if (!rowsOf(consumed).length) {
      throw new UnauthorizedException(INVALID_OTP);
    }
  }

  /** Spends one bcrypt compare's worth of time. Always resolves false. */
  private async burnHashTime(input: string): Promise<false> {
    this.dummyHash ??= bcrypt.hash(randomUUID(), BCRYPT_COST);
    await bcrypt.compare(input, await this.dummyHash);
    return false;
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
      user.adminRequestStatus !== AdminRequestStatus.PENDING ||
      !user.emailVerifiedAt
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

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
