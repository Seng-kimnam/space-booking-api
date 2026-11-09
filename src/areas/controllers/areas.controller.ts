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
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { AreaPageResponseDto } from '../dto/area.dto';
import { AreasService } from '../services/areas.service';

// Per-controller pipe because there is no global one yet; drop it when one is added.
// shortcut: Client `places:read` access (api-clients module) isn't wired yet; this is public.
@ApiTags('areas')
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
)
@Controller()
export class AreasController {
  constructor(private readonly areas: AreasService) {}

  @Get('places/:placeId/areas')
  @ApiOperation({ summary: 'Active areas of a place' })
  @ApiOkResponse({ type: AreaPageResponseDto })
  @ApiBadRequestResponse()
  @ApiNotFoundResponse()
  list(
    @Param('placeId', ParseUUIDPipe) placeId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.areas.listByPlace(placeId, query);
  }
}
