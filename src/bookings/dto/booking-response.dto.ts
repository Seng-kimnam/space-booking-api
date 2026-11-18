import { ApiProperty } from '@nestjs/swagger';
import { PageResponseDto } from '../../common/dto/page-response.dto';
import {
  AttendanceMethod,
  BookingEventType,
  BookingSource,
  BookingStatus,
  QrPurpose,
} from '../../common/enums';
import { formatInZone } from '../domain/time';
import { BookingEvent } from '../entities/booking-event.entity';
import { Booking } from '../entities/booking.entity';

export class BookingSeatDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'A1' })
  label: string;

  @ApiProperty({ format: 'uuid' })
  placeId: string;

  @ApiProperty({ example: 'Demo Library' })
  placeName: string;

  @ApiProperty({ example: 'Asia/Phnom_Penh' })
  timezone: string;
}

export class BookingResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid', description: 'Shared by the seats booked in one request' })
  groupId: string;

  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty({ type: BookingSeatDto })
  seat: BookingSeatDto;

  @ApiProperty({ enum: BookingStatus })
  status: BookingStatus;

  @ApiProperty({ enum: BookingSource })
  source: BookingSource;

  @ApiProperty({ description: 'UTC' })
  startAt: Date;

  @ApiProperty({ description: 'UTC' })
  endAt: Date;

  @ApiProperty({ example: '2026-11-09 10:00', description: "Start in the place's timezone" })
  localStartAt: string;

  @ApiProperty({ example: '2026-11-09 11:00', description: "End in the place's timezone" })
  localEndAt: string;

  @ApiProperty({ type: Date, nullable: true })
  checkedInAt: Date | null;

  @ApiProperty({ enum: AttendanceMethod, nullable: true })
  checkInMethod: AttendanceMethod | null;

  @ApiProperty({ type: Date, nullable: true })
  checkedOutAt: Date | null;

  @ApiProperty({ enum: AttendanceMethod, nullable: true })
  checkOutMethod: AttendanceMethod | null;

  @ApiProperty({ type: Date, nullable: true })
  cancelledAt: Date | null;

  @ApiProperty({ type: String, nullable: true })
  cancelReason: string | null;

  @ApiProperty({ type: Date, nullable: true })
  expiredAt: Date | null;

  @ApiProperty()
  extensionCount: number;

  @ApiProperty()
  createdAt: Date;
}

export class BookingGroupResponseDto {
  @ApiProperty({ format: 'uuid' })
  groupId: string;

  @ApiProperty({ type: [BookingResponseDto] })
  bookings: BookingResponseDto[];
}

export class PaginatedBookingsResponseDto extends PageResponseDto(BookingResponseDto) {}

export class BookingEventResponseDto {
  @ApiProperty({ enum: BookingEventType })
  type: BookingEventType;

  @ApiProperty({ type: Date, nullable: true })
  oldStartAt: Date | null;

  @ApiProperty({ type: Date, nullable: true })
  oldEndAt: Date | null;

  @ApiProperty({ type: Date, nullable: true })
  newStartAt: Date | null;

  @ApiProperty({ type: Date, nullable: true })
  newEndAt: Date | null;

  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  actorUserId: string | null;

  @ApiProperty()
  actorSystem: boolean;

  @ApiProperty()
  createdAt: Date;
}

export class AdminBookingDetailResponseDto extends BookingResponseDto {
  @ApiProperty({ type: [BookingEventResponseDto] })
  events: BookingEventResponseDto[];
}

export class QrCodeDto {
  @ApiProperty({ type: [String], format: 'uuid' })
  bookingIds: string[];

  @ApiProperty({ type: [String], example: ['A1', 'A2'] })
  seatLabels: string[];

  @ApiProperty({ description: 'QR content (single use). Issuing again invalidates it.' })
  payload: string;

  @ApiProperty({ description: 'PNG data URL of the QR image' })
  imageDataUrl: string;

  @ApiProperty()
  expiresAt: Date;
}

export class QrCodesResponseDto {
  @ApiProperty({ enum: QrPurpose })
  purpose: QrPurpose;

  @ApiProperty({ enum: ['GROUP', 'EACH'] })
  mode: 'GROUP' | 'EACH';

  @ApiProperty({ type: [QrCodeDto] })
  codes: QrCodeDto[];
}

export class AttendanceResponseDto {
  @ApiProperty({ enum: QrPurpose })
  action: QrPurpose;

  @ApiProperty({ type: [BookingResponseDto] })
  bookings: BookingResponseDto[];
}

export class CheckInStatusResponseDto {
  @ApiProperty({ format: 'uuid' })
  bookingId: string;

  @ApiProperty({ enum: BookingStatus })
  status: BookingStatus;

  @ApiProperty({ description: 'Check-in accepted from this time' })
  checkInOpensAt: Date;

  @ApiProperty({ description: 'After this, the booking expires and the seat is released' })
  checkInClosesAt: Date;

  @ApiProperty({ type: Date, nullable: true })
  checkedInAt: Date | null;

  @ApiProperty({ type: Date, nullable: true })
  checkedOutAt: Date | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'CHECKED_IN only: minutes until the booking ends (negative = past the end)',
  })
  minutesRemaining: number | null;

  @ApiProperty({
    description: 'CHECKED_IN and within checkout_reminder_minutes of the end (computed, never stored)',
  })
  nearlyTimedOut: boolean;
}

export function toBookingResponse(b: Booking): BookingResponseDto {
  const timezone = b.seat.place.timezone;
  return {
    id: b.id,
    groupId: b.groupId ?? b.id,
    userId: b.userId,
    seat: {
      id: b.seatId,
      label: b.seat.label,
      placeId: b.seat.placeId,
      placeName: b.seat.place.name,
      timezone,
    },
    status: b.status,
    source: b.source,
    startAt: b.timeRange.start,
    endAt: b.timeRange.end,
    localStartAt: formatInZone(b.timeRange.start, timezone),
    localEndAt: formatInZone(b.timeRange.end, timezone),
    checkedInAt: b.checkedInAt,
    checkInMethod: b.checkInMethod,
    checkedOutAt: b.checkedOutAt,
    checkOutMethod: b.checkOutMethod,
    cancelledAt: b.cancelledAt,
    cancelReason: b.cancelReason,
    expiredAt: b.expiredAt,
    extensionCount: b.extensionCount,
    createdAt: b.createdAt,
  };
}

export function toBookingEventResponse(e: BookingEvent): BookingEventResponseDto {
  return {
    type: e.type,
    oldStartAt: e.oldRange?.start ?? null,
    oldEndAt: e.oldRange?.end ?? null,
    newStartAt: e.newRange?.start ?? null,
    newEndAt: e.newRange?.end ?? null,
    actorUserId: e.actorUserId,
    actorSystem: e.actorSystem,
    createdAt: e.createdAt,
  };
}
