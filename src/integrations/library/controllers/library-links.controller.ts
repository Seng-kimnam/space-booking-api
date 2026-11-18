import { Body, Controller, Delete, HttpCode, Param, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiNoContentResponse, ApiNotFoundResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClientSecured, CurrentApiClient } from '../../../api-clients/decorators/client-secured.decorator';
import type { AuthApiClient } from '../../../api-clients/types';
import { Publishes } from '../../../messaging/contract/publishes.decorator';
import { MessageType } from '../../../messaging/contract/schemas';
import { CreateLinkRequestDto, LinkRequestResponseDto } from '../dto/library-link.dto';
import { LibraryLinksService } from '../services/library-links.service';

/** Called by LMS with its API key (scope identities:link). */
@ApiTags('Integrations: library (LMS)')
@Controller('integrations/library')
export class LibraryLinksClientController {
  constructor(private readonly links: LibraryLinksService) {}

  @Post('link-requests')
  @ClientSecured('identities:link')
  @ApiOperation({ summary: 'Start linking an LMS member: returns a one-time code (10 min)' })
  @ApiCreatedResponse({ type: LinkRequestResponseDto })
  async requestLink(
    @CurrentApiClient() client: AuthApiClient,
    @Body() dto: CreateLinkRequestDto,
  ): Promise<LinkRequestResponseDto> {
    const r = await this.links.requestLink(dto.memberId, client.id);
    return { code: r.code, linkUrl: r.linkUrl, expiresAt: r.expiresAt.toISOString() };
  }

  @Delete('links/:memberId')
  @HttpCode(204)
  @ClientSecured('identities:link')
  @Publishes(MessageType.IDENTITY_UNLINKED)
  @ApiOperation({ summary: 'Unlink an LMS member from their Space Booking account' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: 'Member is not linked' })
  unlink(@CurrentApiClient() client: AuthApiClient, @Param('memberId') memberId: string): Promise<void> {
    return this.links.unlinkByMember(memberId, client.id);
  }
}
