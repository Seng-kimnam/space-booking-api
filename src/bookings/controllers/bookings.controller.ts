import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentAuthUser } from '../../common/decorators/current-auth-user.decorator';
import { Secured } from '../../common/decorators/secured.decorator';
import { Roles } from '../../auth/role.decorator';
import { UserRole } from '../../common/enums';
import type { AuthUser } from '../../common/types/auth-user';
import {
  BookingScopeQueryDto,
  CancelBookingDto,
  CreateBookingDto,
  ExtendBookingDto,
  ModifyBookingDto,
  MyBookingsQueryDto,
  PaginationQueryDto,
  QrCodeQueryDto,
} from '../dto/booking-request.dto';
import {
  BookingGroupResponseDto,
  BookingResponseDto,
  CheckInStatusResponseDto,
  PaginatedBookingsResponseDto,
  QrCodesResponseDto,
} from '../dto/booking-response.dto';
import { AttendanceService } from '../services/attendance.service';
import { BookingQrService } from '../services/booking-qr.service';
import { BookingsService } from '../services/bookings.service';
import { Publishes } from '../../messaging/contract/publishes.decorator';
import { MessageType } from '../../messaging/contract/schemas';

const uuid = new ParseUUIDPipe({ version: 'all' });

@ApiTags('Bookings')
@ApiBearerAuth()
@Secured(UserRole.USER)
@Controller('bookings')
export class BookingsController {
  constructor(
    private readonly bookings: BookingsService,
    private readonly qr: BookingQrService,
    private readonly attendance: AttendanceService,
  ) {}

  @Post()
  @Publishes(MessageType.BOOKING_CREATED)
  @ApiOperation({
    summary: 'Reserve one or more seats',
    description:
      'All seats must be in the same place and are booked for the same time, all-or-nothing. Retrying with the same Idempotency-Key returns the original booking.',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiCreatedResponse({ type: BookingGroupResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid time, outside opening hours or policy' })
  @ApiNotFoundResponse({ description: 'A seat does not exist or is not bookable' })
  @ApiConflictResponse({ description: 'A seat is already booked, or the booking limit is reached' })
  create(
    @CurrentAuthUser() user: AuthUser,
    @Body() dto: CreateBookingDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<BookingGroupResponseDto> {
    return this.bookings.create(user, dto, idempotencyKey);
  }

  @Get()
  @ApiOperation({ summary: 'My bookings' })
  @ApiOkResponse({ type: PaginatedBookingsResponseDto })
  list(
    @CurrentAuthUser() user: AuthUser,
    @Query() query: MyBookingsQueryDto,
  ): Promise<PaginatedBookingsResponseDto> {
    return this.bookings.listMine(user, query);
  }

  @Get('upcoming')
  @ApiOperation({ summary: 'My upcoming and ongoing bookings' })
  @ApiOkResponse({ type: PaginatedBookingsResponseDto })
  upcoming(
    @CurrentAuthUser() user: AuthUser,
    @Query() query: PaginationQueryDto,
  ): Promise<PaginatedBookingsResponseDto> {
    return this.bookings.listMine(user, { ...query, view: 'upcoming' });
  }

  @Get('history')
  @ApiOperation({ summary: 'My finished bookings (completed, cancelled, expired)' })
  @ApiOkResponse({ type: PaginatedBookingsResponseDto })
  history(
    @CurrentAuthUser() user: AuthUser,
    @Query() query: PaginationQueryDto,
  ): Promise<PaginatedBookingsResponseDto> {
    return this.bookings.listMine(user, { ...query, view: 'history' });
  }

  @Get(':bookingId')
  @ApiOperation({ summary: 'Booking details' })
  @ApiOkResponse({ type: BookingResponseDto })
  @ApiNotFoundResponse()
  get(
    @CurrentAuthUser() user: AuthUser,
    @Param('bookingId', uuid) bookingId: string,
  ): Promise<BookingResponseDto> {
    return this.bookings.getMine(user, bookingId);
  }

  @Patch(':bookingId')
  @Publishes(MessageType.BOOKING_MODIFIED)
  @ApiOperation({ summary: 'Change date/time (not started, before the modify cutoff)' })
  @ApiOkResponse({ type: BookingGroupResponseDto })
  @ApiConflictResponse({ description: 'Seat taken at the new time, or too late to modify' })
  modify(
    @CurrentAuthUser() user: AuthUser,
    @Param('bookingId', uuid) bookingId: string,
    @Query() { scope }: BookingScopeQueryDto,
    @Body() dto: ModifyBookingDto,
  ): Promise<BookingGroupResponseDto> {
    return this.bookings.modify(user, bookingId, dto, scope ?? 'booking');
  }

  @Post(':bookingId/cancel')
  @Publishes(MessageType.BOOKING_CANCELLED)
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel (not started, before the cutoff)' })
  @ApiOkResponse({ type: BookingGroupResponseDto })
  cancel(
    @CurrentAuthUser() user: AuthUser,
    @Param('bookingId', uuid) bookingId: string,
    @Query() { scope }: BookingScopeQueryDto,
    @Body() dto: CancelBookingDto,
  ): Promise<BookingGroupResponseDto> {
    return this.bookings.cancel(user, bookingId, dto, scope ?? 'booking');
  }

  @Post(':bookingId/extend')
  @Publishes(MessageType.BOOKING_EXTENDED)
  @HttpCode(200)
  @ApiOperation({ summary: 'Extend the end time' })
  @ApiOkResponse({ type: BookingGroupResponseDto })
  @ApiConflictResponse({ description: 'Seat taken after the current end, or no extensions left' })
  extend(
    @CurrentAuthUser() user: AuthUser,
    @Param('bookingId', uuid) bookingId: string,
    @Query() { scope }: BookingScopeQueryDto,
    @Body() dto: ExtendBookingDto,
  ): Promise<BookingGroupResponseDto> {
    return this.bookings.extend(user, bookingId, dto, scope ?? 'booking');
  }

  @Get(':bookingId/qr-code')
  @ApiOperation({
    summary: 'Issue a one-time check-in or check-out QR (revokes the previous one)',
    description:
      'For a multi-seat booking choose mode=GROUP (one QR for all seats) or mode=EACH (one QR per seat).',
  })
  @ApiOkResponse({ type: QrCodesResponseDto })
  async qrCode(
    @CurrentAuthUser() user: AuthUser,
    @Param('bookingId', uuid) bookingId: string,
    @Query() query: QrCodeQueryDto,
  ): Promise<QrCodesResponseDto> {
    return this.qr.issue(user, bookingId, query.purpose!, query.mode!);
  }

  @Get(':bookingId/check-in-status')
  @Roles(UserRole.USER, UserRole.ADMIN)
  @ApiOperation({ summary: 'Attendance status and check-in window' })
  @ApiOkResponse({ type: CheckInStatusResponseDto })
  checkInStatus(
    @CurrentAuthUser() user: AuthUser,
    @Param('bookingId', uuid) bookingId: string,
  ): Promise<CheckInStatusResponseDto> {
    return this.attendance.getCheckInStatus(user, bookingId);
  }
}
