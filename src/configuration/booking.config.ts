import { registerAs } from '@nestjs/config';

export const bookingConfig = registerAs('booking', () => ({
  // How early before the start a check-in QR is accepted. The late end of the
  // window is booking_policies.checkin_grace_minutes (per place).
  checkinEarlyMinutes: Number(process.env.QR_CHECKIN_EARLY_MINUTES ?? 15),
}));
