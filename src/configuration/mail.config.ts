import { registerAs } from '@nestjs/config';

// Locally this points at Mailpit (SMTP on 1025, UI on 8025), which has no TLS,
// so both TLS flags default to off. In production set one of them: OTP codes
// must not cross the network in clear text.
export const mailConfig = registerAs('mail', () => ({
  // Use IPv4 on the host; Windows can resolve localhost to an unreachable
  // IPv6 loopback address while Mailpit is listening on IPv4.
  host: process.env.MAIL_HOST ?? '127.0.0.1',
  port: Number(process.env.MAIL_PORT ?? 1025),
  from: process.env.MAIL_FROM ?? 'no-reply@space-booking.local',
  // Implicit TLS from the first byte (usually port 465).
  secure: process.env.MAIL_SECURE === 'true',
  // STARTTLS required: refuse to send if the server can't upgrade (port 587).
  requireTls: process.env.MAIL_REQUIRE_TLS === 'true',
}));
