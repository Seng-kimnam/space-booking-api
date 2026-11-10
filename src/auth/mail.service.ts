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
      secure: false,
    });
    this.from = this.configService.getOrThrow<string>('mail.from');
  }

  async sendOtp(
    email: string,
    purpose: 'EMAIL_VERIFY' | 'PASSWORD_RESET',
    otp: string,
  ): Promise<void> {
    const subject =
      purpose === 'EMAIL_VERIFY'
        ? 'Verify your Space Booking account'
        : 'Reset your Space Booking password';

    try {
      await this.transporter.sendMail({
        from: this.from,
        to: email,
        subject,
        text: `Your one-time code is ${otp}. It expires in 10 minutes.`,
      });
    } catch (err) {
      const { code, responseCode, command } = (err ?? {}) as SmtpErrorInfo;
      this.logger.error(
        `OTP email not sent: purpose=${purpose} code=${code ?? 'unknown'}` +
          (responseCode ? ` smtp=${responseCode}` : '') +
          (command ? ` command=${command}` : ''),
      );
      // Unchanged behaviour: the caller still sees the failure.
      throw err;
    }
    this.logger.log(`OTP email sent: purpose=${purpose}`);
  }
}
