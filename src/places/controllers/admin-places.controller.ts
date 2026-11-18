import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
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
import { UserRole } from '../../common/enums';
import { Secured } from '../../common/decorators/secured.decorator';
import { PlacesService } from '../services/places.service';
import { CreatePlaceDto } from '../dto/create-place.dto';
import { UpdatePlaceDto } from '../dto/update-place.dto';
import { PlaceDetailResponseDto } from '../dto/place.response.dto';
import { Publishes } from '../../messaging/contract/publishes.decorator';
import { MessageType } from '../../messaging/contract/schemas';

// Per-controller pipe because there is no global one yet; drop it when one is added.
@ApiTags('Places')
@ApiBearerAuth()
@ApiUnauthorizedResponse()
@ApiForbiddenResponse()
@Secured(UserRole.ADMIN)
@Controller('admin/places')
export class AdminPlacesController {
  constructor(private readonly places: PlacesService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a place (+ booking policy, opening hours, closures)',
  })
  @ApiCreatedResponse({ type: PlaceDetailResponseDto })
  @ApiBadRequestResponse()
  create(@Body() dto: CreatePlaceDto) {
    return this.places.create(dto);
  }

  @Patch(':placeId')
  @Publishes(MessageType.PLACE_SYNC_APPLIED)
  @ApiOperation({
    summary: 'Update place, opening hours, closures and/or policy',
    description:
      'openingHours and closures, when sent, replace the whole set. bookingPolicy is merged.',
  })
  @ApiOkResponse({ type: PlaceDetailResponseDto })
  @ApiBadRequestResponse()
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'Concurrent change, retry' })
  update(
    @Param('placeId', ParseUUIDPipe) placeId: string,
    @Body() dto: UpdatePlaceDto,
  ) {
    return this.places.update(placeId, dto);
  }

  @Delete(':placeId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Soft-delete a place' })
  @ApiNoContentResponse()
  @ApiBadRequestResponse()
  @ApiNotFoundResponse()
  softDelete(@Param('placeId', ParseUUIDPipe) placeId: string) {
    return this.places.softDelete(placeId);
  }
}
