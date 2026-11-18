import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import type { SeatAvailability } from '../seats.ports';
import { SeatPageResponseDto } from './seat.response.dto';

export class SeatAvailabilityQueryDto {
  @ApiProperty({
    example: '2026-11-09T03:00:00.000Z',
    description: 'Window start, UTC, ISO 8601',
  })
  @IsISO8601({ strict: true })
  startAt: string;

  @ApiProperty({
    example: '2026-11-09T04:00:00.000Z',
    description:
      'Window end (exclusive), UTC, ISO 8601. At most 31 days after startAt.',
  })
  @IsISO8601({ strict: true })
  endAt: string;
}

export class AvailableSeatsQueryDto extends PaginationQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  placeId: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  areaId?: string;

  @ApiProperty({
    example: '2026-11-09T03:00:00.000Z',
    description: 'UTC, ISO 8601',
  })
  @IsISO8601({ strict: true })
  startAt: string;

  @ApiProperty({
    example: '2026-11-09T04:00:00.000Z',
    description: 'Exclusive, UTC, ISO 8601. At most 31 days after startAt.',
  })
  @IsISO8601({ strict: true })
  endAt: string;
}

export class AvailableSeatPageResponseDto extends SeatPageResponseDto {
  @ApiProperty({
    description:
      'False when the place is closed during part of the window (then items is empty)',
  })
  placeOpen: boolean;
}

export class BusyRangeDto {
  @ApiProperty({ format: 'date-time' }) startAt: string;
  @ApiProperty({ format: 'date-time' }) endAt: string;
}

export class SeatAvailabilityResponseDto {
  @ApiProperty({ format: 'uuid' }) seatId: string;
  @ApiProperty({ format: 'uuid' }) placeId: string;
  @ApiProperty({ format: 'date-time' }) startAt: string;
  @ApiProperty({ format: 'date-time' }) endAt: string;
  @ApiProperty({ description: 'The whole window can be booked now' })
  available: boolean;
  @ApiProperty({ description: 'Seat ACTIVE and its place open for booking' })
  bookable: boolean;
  @ApiProperty({
    description: 'Place open for the whole window (hours and closures)',
  })
  placeOpen: boolean;
  @ApiProperty({
    description: 'Someone is in the seat now (checked in, or checkout overdue)',
  })
  occupiedNow: boolean;
  @ApiProperty({
    type: [BusyRangeDto],
    description:
      'Booked ranges overlapping the window (no booking or user ids)',
  })
  busy: BusyRangeDto[];
}

export function toSeatAvailabilityResponse(
  seat: { id: string; placeId: string },
  start: Date,
  end: Date,
  a: SeatAvailability,
): SeatAvailabilityResponseDto {
  return {
    seatId: seat.id,
    placeId: seat.placeId,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    available: a.available,
    bookable: a.bookable,
    placeOpen: a.placeOpen,
    occupiedNow: a.occupiedNow,
    busy: a.busy.map((r) => ({
      startAt: r.start.toISOString(),
      endAt: r.end.toISOString(),
    })),
  };
}
