import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ClientSecured, CurrentApiClient } from '../../api-clients/decorators/client-secured.decorator';
import type { AuthApiClient } from '../../api-clients/types';
import { CurrentAuthUser } from '../../common/decorators/current-auth-user.decorator';
import { Secured } from '../../common/decorators/secured.decorator';
import { UserRole } from '../../common/enums';
import type { AuthUser } from '../../common/types/auth-user';
import type { ExternalIdentity } from '../../external-identities/entities/external-identity.entity';
import { Publishes } from '../../messaging/contract/publishes.decorator';
import { MessageType } from '../../messaging/contract/schemas';
import {
  ConfirmLinkDto,
  CreateLinkRequestDto,
  LibraryLinkResponseDto,
  LinkRequestResponseDto,
} from './dto/library-link.dto';
import { LibraryLinksService } from './library-links.service';

const toLinkResponse = (l: ExternalIdentity): LibraryLinkResponseDto => ({
  system: l.externalSystem,
  memberId: l.externalUserId,
  linkedAt: l.linkedAt.toISOString(),
  eligible: l.standingEligible,
});

/** Called BY LMS with its API key (scope identities:link). */
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

/** The logged-in Space Booking user manages their own LMS link. */
@ApiTags('Integrations: library (LMS)')
@ApiBearerAuth()
@ApiUnauthorizedResponse()
@ApiForbiddenResponse()
@Secured(UserRole.USER)
@Controller('integrations/library/my-link')
export class LibraryMyLinkController {
  constructor(private readonly links: LibraryLinksService) {}

  @Post()
  @Publishes(MessageType.IDENTITY_LINKED)
  @ApiOperation({ summary: 'Confirm a link code from LMS, linking your account to your LMS member' })
  @ApiCreatedResponse({ type: LibraryLinkResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid, used or expired code' })
  @ApiConflictResponse({ description: 'You or that member are already linked' })
  async confirm(@CurrentAuthUser() user: AuthUser, @Body() dto: ConfirmLinkDto): Promise<LibraryLinkResponseDto> {
    return toLinkResponse(await this.links.confirm(user.id, dto.code));
  }

  @Get()
  @ApiOperation({ summary: 'Your linked LMS member, if any' })
  @ApiOkResponse({ type: LibraryLinkResponseDto })
  @ApiNotFoundResponse({ description: 'Not linked' })
  async get(@CurrentAuthUser() user: AuthUser): Promise<LibraryLinkResponseDto> {
    return toLinkResponse(await this.links.getForUser(user.id));
  }

  @Delete()
  @HttpCode(204)
  @Publishes(MessageType.IDENTITY_UNLINKED)
  @ApiOperation({ summary: 'Unlink your LMS member' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: 'Not linked' })
  unlink(@CurrentAuthUser() user: AuthUser): Promise<void> {
    return this.links.unlinkByUser(user.id);
  }
}
