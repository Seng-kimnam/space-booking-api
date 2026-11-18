import {
  Controller,
  Get,
  Inject,
  NotImplementedException,
  Optional,
  Param,
  ParseUUIDPipe,
  Query,
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
import {
  AvailableSeatPageResponseDto,
  AvailableSeatsQueryDto,
  SeatAvailabilityQueryDto,
  SeatAvailabilityResponseDto,
  toSeatAvailabilityResponse,
} from '../dto/seat-availability.dto';
import { SEAT_AVAILABILITY } from '../seats.ports';
import type { SeatAvailabilityPort } from '../seats.ports';

@ApiTags('Seats')
@Controller()
export class SeatsController {
  constructor(
    private readonly seats: SeatsService,
    // Bound by bookings (BookingsBindingsModule); optional so seats-only tests compile.
    @Optional()
    @Inject(SEAT_AVAILABILITY)
    private readonly availability?: SeatAvailabilityPort,
  ) {}

  private availabilityPort(): SeatAvailabilityPort {
    if (!this.availability)
      throw new NotImplementedException('Seat availability is not available');
    return this.availability;
  }

  @Get('seats')
  @ApiOperation({ summary: 'List seats (filter by place, area, status)' })
  @ApiOkResponse({ type: SeatPageResponseDto })
  @ApiBadRequestResponse()
  list(@Query() query: SeatQueryDto) {
    return this.seats.list(query);
  }

  // Declared before seats/:seatId, which would otherwise match "available".
  @Get('seats/available')
  @ApiOperation({
    summary: 'Seats of a place free for a whole time window',
    description:
      'ACTIVE seats with no live booking overlapping [startAt, endAt). Empty with placeOpen=false when the place is closed during part of the window. Informational: booking can still fail with 409 if someone is faster.',
  })
  @ApiOkResponse({ type: AvailableSeatPageResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid window (end before start, longer than 31 days)' })
  @ApiNotFoundResponse({ description: 'Place not found or inactive' })
  async available(
    @Query() query: AvailableSeatsQueryDto,
  ): Promise<AvailableSeatPageResponseDto> {
    const page = await this.availabilityPort().availableSeats({
      placeId: query.placeId,
      areaId: query.areaId,
      start: new Date(query.startAt),
      end: new Date(query.endAt),
      page: query.page,
      limit: query.limit,
    });
    return {
      items: page.items.map(toSeatResponse),
      page: query.page,
      limit: query.limit,
      total: page.total,
      placeOpen: page.placeOpen,
    };
  }

  @Get('seats/:seatId/availability')
  @ApiOperation({
    summary: 'Seat availability for a time window',
    description:
      'Booked ranges overlapping [startAt, endAt) (no booking or user ids), whether the place is open, and whether someone is in the seat now.',
  })
  @ApiOkResponse({ type: SeatAvailabilityResponseDto })
  @ApiBadRequestResponse()
  @ApiNotFoundResponse()
  async seatAvailability(
    @Param('seatId', ParseUUIDPipe) seatId: string,
    @Query() query: SeatAvailabilityQueryDto,
  ): Promise<SeatAvailabilityResponseDto> {
    const seat = await this.seats.findOne(seatId);
    const start = new Date(query.startAt);
    const end = new Date(query.endAt);
    return toSeatAvailabilityResponse(
      seat,
      start,
      end,
      await this.availabilityPort().seatAvailability(seat, start, end),
    );
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
