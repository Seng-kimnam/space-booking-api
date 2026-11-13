import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';

/** Fields of a nodemailer/SMTP error that are safe to log. */
interface SmtpErrorInfo {
  code?: string;
  responseCode?: number;
  command?: string;
}

@Injectable()
export class MailService {
  // Forwards to AppLogger (main.ts). Never logs the recipient, the OTP or the
  // SMTP error text: SMTP replies often echo the address ("<a@b.c>: rejected").
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(private readonly configService: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: this.configService.getOrThrow<string>('mail.host'),
      port: this.configService.getOrThrow<number>('mail.port'),
      // TLS settings come from mail.config.ts (MAIL_SECURE, MAIL_REQUIRE_TLS).
      secure: this.configService.getOrThrow<boolean>('mail.secure'),
      requireTLS: this.configService.getOrThrow<boolean>('mail.requireTls'),
    });
    this.from = this.configService.getOrThrow<string>('mail.from');
  }

  async sendOtp(
    email: string,
    purpose: 'EMAIL_VERIFY' | 'PASSWORD_RESET' | 'EMAIL_CHANGE',
    otp: string,
  ): Promise<void> {
    const subject = {
      EMAIL_VERIFY: 'Verify your Space Booking account',
      PASSWORD_RESET: 'Reset your Space Booking password',
      EMAIL_CHANGE: 'Confirm your new Space Booking email address',
    }[purpose];
    await this.send(
      email,
      subject,
      `Your one-time code is ${otp}. It expires in 10 minutes.`,
      purpose,
    );
  }

  /** Security notice to the OLD address after an email change. Contains no secret. */
  async sendEmailChanged(email: string): Promise<void> {
    await this.send(
      email,
      'Your Space Booking email address was changed',
      'The email address of your account was just changed. ' +
        'If this was not you, contact support immediately.',
      'EMAIL_CHANGED',
    );
  }

  /** Security notice after a password change or reset. Contains no secret. */
  async sendPasswordChanged(email: string): Promise<void> {
    await this.send(
      email,
      'Your Space Booking password was changed',
      'Your password was just changed and you were signed out on every device. ' +
        'If this was not you, reset your password now and contact support.',
      'PASSWORD_CHANGED',
    );
  }

  private async send(
    to: string,
    subject: string,
    text: string,
    purpose: string,
  ): Promise<void> {
    const kind = purpose.endsWith('_CHANGED') ? 'Notice' : 'OTP';
    try {
      await this.transporter.sendMail({ from: this.from, to, subject, text });
    } catch (err) {
      const { code, responseCode, command } = (err ?? {}) as SmtpErrorInfo;
      this.logger.error(
        `${kind} email not sent: purpose=${purpose} code=${code ?? 'unknown'}` +
          (responseCode ? ` smtp=${responseCode}` : '') +
          (command ? ` command=${command}` : ''),
      );
      // The caller decides whether a failure matters (AuthService doesn't
      // await mail on the request path, so it never reaches the client).
      throw err;
    }
    this.logger.log(`${kind} email sent: purpose=${purpose}`);
  }
}
