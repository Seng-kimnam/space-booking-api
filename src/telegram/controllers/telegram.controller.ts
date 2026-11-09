import { Controller, Delete, Get, HttpCode, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentAuthUser } from '../../common/decorators/current-auth-user.decorator';
import { Secured } from '../../common/decorators/secured.decorator';
import { UserRole } from '../../users/entities/user.entity';
import type { AuthUser } from '../../common/types/auth-user';
import {
  TelegramLinkResponseDto,
  TelegramStatusResponseDto,
} from '../dto/telegram.response.dto';
import { TelegramAccountsService } from '../services/telegram-accounts.service';

@ApiTags('Telegram')
@ApiBearerAuth()
@Secured(UserRole.USER)
@Controller('telegram')
export class TelegramController {
  constructor(private readonly accounts: TelegramAccountsService) {}

  @Post('link')
  @ApiOperation({
    summary: 'Get a link to subscribe to the Telegram bot',
    description:
      'Returns a one-time t.me deep link. Opening it and pressing Start links the chat to this account.',
  })
  @ApiCreatedResponse({ type: TelegramLinkResponseDto })
  @ApiConflictResponse({ description: 'Telegram is already linked' })
  link(@CurrentAuthUser() user: AuthUser): Promise<TelegramLinkResponseDto> {
    return this.accounts.createLink(user.id);
  }

  @Get('status')
  @ApiOperation({ summary: 'Telegram connection status' })
  @ApiOkResponse({ type: TelegramStatusResponseDto })
  status(@CurrentAuthUser() user: AuthUser): Promise<TelegramStatusResponseDto> {
    return this.accounts.getStatus(user.id);
  }

  @Delete('unlink')
  @HttpCode(204)
  @ApiOperation({ summary: 'Unsubscribe from the Telegram bot' })
  @ApiNoContentResponse()
  unlink(@CurrentAuthUser() user: AuthUser): Promise<void> {
    return this.accounts.unlink(user.id);
  }
}
