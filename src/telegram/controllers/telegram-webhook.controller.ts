import {
  Body,
  Controller,
  HttpCode,
  Logger,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import {
  TELEGRAM_SECRET_HEADER,
  TelegramSecretGuard,
} from '../guards/telegram-secret.guard';
import { TelegramUpdatesService } from '../services/telegram-updates.service';
import type { TelegramUpdate } from '../telegram.types';

@ApiTags('Telegram')
@Controller('webhooks/telegram')
export class TelegramWebhookController {
  private readonly logger = new Logger(TelegramWebhookController.name);

  constructor(private readonly updates: TelegramUpdatesService) {}

  @Public()
  @UseGuards(TelegramSecretGuard)
  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Receive Telegram updates (called by Telegram only)',
    description:
      'Handles /start <code> (link), /stop (unlink), /status, and the user blocking the bot.',
  })
  @ApiHeader({ name: TELEGRAM_SECRET_HEADER, required: true })
  @ApiOkResponse()
  @ApiUnauthorizedResponse({ description: 'Missing or wrong secret header' })
  // `TelegramUpdate` is an interface, so the ValidationPipe leaves the body
  // alone: Telegram's payload has many fields we don't whitelist.
  async receive(@Body() update: TelegramUpdate): Promise<{ ok: true }> {
    try {
      await this.updates.handle(update);
    } catch (err) {
      // Always 200: a non-2xx makes Telegram redeliver the same update forever.
      this.logger.error(
        `Telegram update ${String(update?.update_id)} failed: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
    }
    return { ok: true };
  }
}
