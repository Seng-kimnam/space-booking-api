import { Controller, Get, Param } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ClientSecured } from '../../../api-clients/decorators/client-secured.decorator';
import { LibraryPlaceSyncStatusDto } from '../dto/library-place.dto';
import { LmsIdPipe } from '../pipes/lms-id.pipe';
import { LibraryPlaceSyncService } from '../services/library-place-sync.service';

/** Called by LMS with its API key (scope places:read). */
@ApiTags('Integrations: library (LMS)')
@ClientSecured('places:read')
@Controller('integrations/library/places')
export class LibraryPlacesController {
  constructor(private readonly sync: LibraryPlaceSyncService) {}

  @Get(':placeId')
  @ApiOperation({ summary: 'Sync status of an LMS place: applied revision, booking open, seat id mapping' })
  @ApiParam({ name: 'placeId', description: 'LMS place id', example: '1' })
  @ApiOkResponse({ type: LibraryPlaceSyncStatusDto })
  @ApiNotFoundResponse({ description: 'No snapshot of this place applied yet' })
  status(@Param('placeId', LmsIdPipe) placeId: string): Promise<LibraryPlaceSyncStatusDto> {
    return this.sync.status(placeId);
  }
}
