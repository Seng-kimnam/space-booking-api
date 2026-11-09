import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { PlacesService } from '../services/places.service';
import { PlaceQueryDto } from '../dto/place-query.dto';
import {
  PlaceDetailResponseDto,
  PlacePageResponseDto,
} from '../dto/place.response.dto';

// Per-controller pipe because there is no global one yet; drop it when one is added.
@ApiTags('places')
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
)
@Controller('places')
export class PlacesController {
  constructor(private readonly places: PlacesService) {}

  @Get()
  @ApiOperation({ summary: 'List / search places' })
  @ApiOkResponse({ type: PlacePageResponseDto })
  @ApiBadRequestResponse()
  list(@Query() query: PlaceQueryDto) {
    return this.places.list(query);
  }

  @Get(':placeId')
  @ApiOperation({
    summary: 'Place details (opening hours, upcoming closures, booking policy)',
  })
  @ApiOkResponse({ type: PlaceDetailResponseDto })
  @ApiBadRequestResponse()
  @ApiNotFoundResponse()
  findOne(@Param('placeId', ParseUUIDPipe) placeId: string) {
    return this.places.findVisible(placeId);
  }
}
