import { registerAs } from '@nestjs/config';

// Locally this points at Mailpit (SMTP on 1025, UI on 8025).
export const mailConfig = registerAs('mail', () => ({
  host: process.env.MAIL_HOST ?? 'localhost',
  port: Number(process.env.MAIL_PORT ?? 1025),
}));
