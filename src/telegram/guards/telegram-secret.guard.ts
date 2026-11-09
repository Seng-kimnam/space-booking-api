import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import { telegramConfig } from '../../configuration/telegram.config';

export const TELEGRAM_SECRET_HEADER = 'x-telegram-bot-api-secret-token';

/** Constant-time compare; hashing first makes both sides the same length. */
export function secretsMatch(received: string, expected: string): boolean {
  const a = createHash('sha256').update(received).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * Only Telegram knows the secret we passed to setWebhook. With no secret
 * configured, every call is rejected rather than leaving the webhook open.
 */
@Injectable()
export class TelegramSecretGuard implements CanActivate {
  constructor(
    @Inject(telegramConfig.KEY)
    private readonly config: ConfigType<typeof telegramConfig>,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const received = request.header(TELEGRAM_SECRET_HEADER);
    const expected = this.config.webhookSecret;

    if (!expected || !received || !secretsMatch(received, expected)) {
      throw new UnauthorizedException();
    }
    return true;
  }
}
