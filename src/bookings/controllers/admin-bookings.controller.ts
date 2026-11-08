import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../auth/current-user.decorator';
import { Roles } from '../../auth/role.decorator';
import { UserRole } from '../../common/enums';
import type { AuthUser } from '../../common/types/auth-user';
import {
  AdminBookingsQueryDto,
  AdminUpdateBookingStatusDto,
} from '../dto/booking-request.dto';
import {
  AdminBookingDetailResponseDto,
  AttendanceResponseDto,
  BookingResponseDto,
  PaginatedBookingsResponseDto,
} from '../dto/booking-response.dto';
import { AttendanceService } from '../services/attendance.service';
import { BookingsService } from '../services/bookings.service';

const uuid = new ParseUUIDPipe({ version: 'all' });

@ApiTags('Admin: bookings')
@ApiBearerAuth()
@Roles(UserRole.ADMIN)
@Controller('admin/bookings')
export class AdminBookingsController {
  constructor(
    private readonly bookings: BookingsService,
    private readonly attendance: AttendanceService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'All bookings' })
  @ApiOkResponse({ type: PaginatedBookingsResponseDto })
  list(@Query() query: AdminBookingsQueryDto): Promise<PaginatedBookingsResponseDto> {
    return this.bookings.listAll(query);
  }

  @Get(':bookingId')
  @ApiOperation({ summary: 'Any booking, with its event history' })
  @ApiOkResponse({ type: AdminBookingDetailResponseDto })
  @ApiNotFoundResponse()
  get(@Param('bookingId', uuid) bookingId: string): Promise<AdminBookingDetailResponseDto> {
    return this.bookings.getAnyWithEvents(bookingId);
  }

  @Patch(':bookingId/status')
  @ApiOperation({ summary: 'Cancel a booking, or resolve a forgotten checkout' })
  @ApiOkResponse({ type: BookingResponseDto })
  @ApiConflictResponse({ description: 'Not allowed from the current status' })
  async updateStatus(
    @CurrentUser() admin: AuthUser,
    @Param('bookingId', uuid) bookingId: string,
    @Body() dto: AdminUpdateBookingStatusDto,
  ): Promise<BookingResponseDto> {
    if (dto.action === 'CANCEL') {
      return this.bookings.adminCancel(admin, bookingId, dto.reason ?? null);
    }
    const result = await this.attendance.resolveOverdue(admin, bookingId);
    return result.bookings[0];
  }

  @Post(':bookingId/check-in')
  @HttpCode(200)
  @ApiOperation({ summary: 'Manual check-in' })
  @ApiOkResponse({ type: AttendanceResponseDto })
  checkIn(
    @CurrentUser() admin: AuthUser,
    @Param('bookingId', uuid) bookingId: string,
  ): Promise<AttendanceResponseDto> {
    return this.attendance.manualCheckIn(admin, bookingId);
  }

  @Post(':bookingId/check-out')
  @HttpCode(200)
  @ApiOperation({ summary: 'Manual check-out' })
  @ApiOkResponse({ type: AttendanceResponseDto })
  checkOut(
    @CurrentUser() admin: AuthUser,
    @Param('bookingId', uuid) bookingId: string,
  ): Promise<AttendanceResponseDto> {
    return this.attendance.manualCheckOut(admin, bookingId);
  }
}
