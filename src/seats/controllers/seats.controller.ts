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
import { SeatsService } from '../services/seats.service';
import { PlaceSeatQueryDto, SeatQueryDto } from '../dto/seat-query.dto';
import {
  SeatPageResponseDto,
  SeatResponseDto,
  toSeatResponse,
} from '../dto/seat.response.dto';

// Per-controller pipe because there is no global one yet; drop it when one is added.
@ApiTags('seats')
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
)
@Controller()
export class SeatsController {
  constructor(private readonly seats: SeatsService) {}

  @Get('seats')
  @ApiOperation({ summary: 'List seats (filter by place, area, status)' })
  @ApiOkResponse({ type: SeatPageResponseDto })
  @ApiBadRequestResponse()
  list(@Query() query: SeatQueryDto) {
    return this.seats.list(query);
  }

  @Get('seats/:seatId')
  @ApiOperation({ summary: 'Seat details' })
  @ApiOkResponse({ type: SeatResponseDto })
  @ApiBadRequestResponse()
  @ApiNotFoundResponse()
  async findOne(@Param('seatId', ParseUUIDPipe) seatId: string) {
    return toSeatResponse(await this.seats.findOne(seatId));
  }

  @Get('places/:placeId/seats')
  @ApiOperation({ summary: 'Seats in a place' })
  @ApiOkResponse({ type: SeatPageResponseDto })
  @ApiBadRequestResponse()
  @ApiNotFoundResponse()
  listByPlace(
    @Param('placeId', ParseUUIDPipe) placeId: string,
    @Query() query: PlaceSeatQueryDto,
  ) {
    return this.seats.listByPlace(placeId, query);
  }
}
