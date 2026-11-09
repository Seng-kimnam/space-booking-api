import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { BookingStatus, QrPurpose } from '../../common/enums';
import type { BookingListView } from '../repositories/bookings.repository';
import type { QrMode } from '../services/booking-qr.service';

/** Hard cap per request; booking_policies.max_active_per_user still applies. */
export const MAX_SEATS_PER_BOOKING = 10;

export class CreateBookingDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    description:
      'One or more seats in the same place, all booked for the same time. All-or-nothing: if any seat is taken, nothing is booked (409).',
    example: ['33333333-3333-4333-8333-3333333300a1'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SEATS_PER_BOOKING)
  @IsUUID('all', { each: true })
  seatIds: string[];

  @ApiProperty({ example: '2026-11-09T03:00:00.000Z', description: 'UTC, ISO 8601' })
  @IsISO8601({ strict: true })
  startAt: string;

  @ApiProperty({ example: '2026-11-09T04:00:00.000Z', description: 'UTC, ISO 8601' })
  @IsISO8601({ strict: true })
  endAt: string;
}

export class ModifyBookingDto {
  @ApiProperty({ example: '2026-11-09T05:00:00.000Z' })
  @IsISO8601({ strict: true })
  startAt: string;

  @ApiProperty({ example: '2026-11-09T06:00:00.000Z' })
  @IsISO8601({ strict: true })
  endAt: string;
}

export class ExtendBookingDto {
  @ApiProperty({ example: '2026-11-09T04:30:00.000Z', description: 'New end time' })
  @IsISO8601({ strict: true })
  endAt: string;
}

export class CancelBookingDto {
  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}

export class BookingScopeQueryDto {
  @ApiPropertyOptional({
    enum: ['booking', 'group'],
    default: 'booking',
    description: '`group` applies the change to every seat booked together with this one.',
  })
  @IsOptional()
  @IsIn(['booking', 'group'])
  scope?: 'booking' | 'group' = 'booking';
}

export class PaginationQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class MyBookingsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['all', 'upcoming', 'history'], default: 'all' })
  @IsOptional()
  @IsIn(['all', 'upcoming', 'history'])
  view?: BookingListView = 'all';
}

export class AdminBookingsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: BookingStatus })
  @IsOptional()
  @IsEnum(BookingStatus)
  status?: BookingStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('all')
  userId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('all')
  seatId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('all')
  placeId?: string;

  @ApiPropertyOptional({ description: 'Bookings overlapping [from, to), ISO 8601' })
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;
}

export class QrCodeQueryDto {
  @ApiPropertyOptional({ enum: QrPurpose, default: QrPurpose.CHECK_IN })
  @IsOptional()
  @IsEnum(QrPurpose)
  purpose?: QrPurpose = QrPurpose.CHECK_IN;

  @ApiPropertyOptional({
    enum: ['GROUP', 'EACH'],
    default: 'GROUP',
    description:
      'For a multi-seat booking: GROUP = one QR for all seats, EACH = one QR per seat. A single seat always gets one QR.',
  })
  @IsOptional()
  @IsIn(['GROUP', 'EACH'])
  mode?: QrMode = 'GROUP';
}

export class ScanQrDto {
  @ApiProperty({ description: 'The scanned QR content', example: 'sb1.b.<bookingId>.<secret>' })
  @IsString()
  @MaxLength(200)
  qr: string;
}

export class AdminUpdateBookingStatusDto {
  @ApiProperty({
    enum: ['CANCEL', 'RESOLVE_OVERDUE'],
    description: 'CANCEL a pending booking, or RESOLVE_OVERDUE (forgotten checkout -> COMPLETED).',
  })
  @IsIn(['CANCEL', 'RESOLVE_OVERDUE'])
  action: 'CANCEL' | 'RESOLVE_OVERDUE';

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}
