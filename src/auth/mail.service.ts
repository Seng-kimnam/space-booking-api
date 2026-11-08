import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';

@Injectable()
export class MailService {
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

  sendOtp(
    email: string,
    purpose: 'EMAIL_VERIFY' | 'PASSWORD_RESET',
    otp: string,
  ): Promise<void> {
    const subject =
      purpose === 'EMAIL_VERIFY'
        ? 'Verify your Space Booking account'
        : 'Reset your Space Booking password';

    return this.transporter
      .sendMail({
        from: this.from,
        to: email,
        subject,
        text: `Your one-time code is ${otp}. It expires in 10 minutes.`,
      })
      .then(() => undefined);
  }
}
