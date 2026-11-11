import { BadRequestException, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ClientSecured } from '../../api-clients/decorators/client-secured.decorator';
import { Secured } from '../../common/decorators/secured.decorator';
import { UserRole } from '../../common/enums';
import { LibraryPlaceSyncStatusDto, LibraryResyncResponseDto } from './dto/library-place.dto';
import { LibraryPlaceRepairService } from './library-place-repair.service';
import { LibraryPlaceSyncService } from './library-place-sync.service';

const LMS_ID = 'placeId';
// LMS place ids: same rule as the contract (place.snapshot.v1.json).
const LMS_ID_PATTERN = /^[0-9A-Za-z_-]{1,64}$/;

function assertLmsId(id: string): void {
  if (!LMS_ID_PATTERN.test(id)) throw new BadRequestException('placeId must match [0-9A-Za-z_-]{1,64}');
}

/** Called BY LMS with its API key (scope places:read). */
@ApiTags('Integrations: library (LMS)')
@ClientSecured('places:read')
@Controller('integrations/library/places')
export class LibraryPlacesController {
  constructor(private readonly sync: LibraryPlaceSyncService) {}

  @Get(`:${LMS_ID}`)
  @ApiOperation({ summary: 'Sync status of an LMS place: applied revision, booking open, seat id mapping' })
  @ApiParam({ name: LMS_ID, description: 'LMS place id', example: '1' })
  @ApiOkResponse({ type: LibraryPlaceSyncStatusDto })
  @ApiNotFoundResponse({ description: 'No snapshot of this place applied yet' })
  status(@Param(LMS_ID) placeId: string): Promise<LibraryPlaceSyncStatusDto> {
    assertLmsId(placeId);
    return this.sync.status(placeId);
  }
}

/** Our admins: pull a place from LMS now (after a DLQ incident or a rejected snapshot was fixed). */
@ApiTags('Integrations: library (LMS)')
@ApiBearerAuth()
@ApiUnauthorizedResponse()
@ApiForbiddenResponse()
@Secured(UserRole.ADMIN)
@Controller('admin/integrations/library/places')
export class AdminLibraryPlacesController {
  constructor(private readonly repair: LibraryPlaceRepairService) {}

  @Post(`:${LMS_ID}/resync`)
  @HttpCode(200)
  @ApiOperation({ summary: 'Fetch the place snapshot from LMS over HTTP and apply it' })
  @ApiParam({ name: LMS_ID, description: 'LMS place id', example: '1' })
  @ApiOkResponse({ type: LibraryResyncResponseDto })
  @ApiNotFoundResponse({ description: 'LMS has no such place' })
  @ApiServiceUnavailableResponse({ description: 'LMS_BASE_URL not configured' })
  async resync(@Param(LMS_ID) placeId: string): Promise<LibraryResyncResponseDto> {
    assertLmsId(placeId);
    const outcome = await this.repair.resyncLmsPlace(placeId);
    if (outcome.result === 'applied')
      return { result: 'applied', cancelledBookings: outcome.cancelledBookings };
    if (outcome.result === 'rejected') return { result: 'rejected', code: outcome.code };
    return { result: 'stale' };
  }
}
