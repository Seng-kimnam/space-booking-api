import { Controller, HttpCode, Param, Post } from '@nestjs/common';
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
import { Secured } from '../../../common/decorators/secured.decorator';
import { UserRole } from '../../../common/enums';
import { Publishes } from '../../../messaging/contract/publishes.decorator';
import { MessageType } from '../../../messaging/contract/schemas';
import { LibraryResyncResponseDto } from '../dto/library-place.dto';
import { LmsIdPipe } from '../pipes/lms-id.pipe';
import { LibraryPlaceRepairService } from '../services/library-place-repair.service';
import type { SyncOutcome } from '../services/library-place-sync.service';

const toResyncResponse = (outcome: SyncOutcome): LibraryResyncResponseDto => {
  if (outcome.result === 'applied') return { result: 'applied', cancelledBookings: outcome.cancelledBookings };
  if (outcome.result === 'rejected') return { result: 'rejected', code: outcome.code };
  return { result: 'stale' };
};

/** Lets our admins pull a place from LMS right now, e.g. after a DLQ incident. */
@ApiTags('Integrations: library (LMS)')
@ApiBearerAuth()
@ApiUnauthorizedResponse()
@ApiForbiddenResponse()
@Secured(UserRole.ADMIN)
@Controller('admin/integrations/library/places')
export class AdminLibraryPlacesController {
  constructor(private readonly repair: LibraryPlaceRepairService) {}

  @Post(':placeId/resync')
  @Publishes(MessageType.PLACE_SYNC_APPLIED, MessageType.PLACE_SYNC_REJECTED, MessageType.BOOKING_CANCELLED)
  @HttpCode(200)
  @ApiOperation({ summary: 'Fetch the place snapshot from LMS over HTTP and apply it' })
  @ApiParam({ name: 'placeId', description: 'LMS place id', example: '1' })
  @ApiOkResponse({ type: LibraryResyncResponseDto })
  @ApiNotFoundResponse({ description: 'LMS has no such place' })
  @ApiServiceUnavailableResponse({ description: 'LMS_BASE_URL not configured' })
  async resync(@Param('placeId', LmsIdPipe) placeId: string): Promise<LibraryResyncResponseDto> {
    return toResyncResponse(await this.repair.resyncLmsPlace(placeId));
  }
}
