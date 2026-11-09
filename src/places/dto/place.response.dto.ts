import { ApiProperty } from '@nestjs/swagger';
import { PlaceType } from '../../common/enums';
import { BookingPolicy } from '../entities/booking-policy.entity';
import { PlaceClosure } from '../entities/place-closure.entity';
import { PlaceOpeningHour } from '../entities/place-opening-hour.entity';
import { Place } from '../entities/place.entity';

export class PlaceResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: PlaceType }) type: PlaceType;
  @ApiProperty({ nullable: true, type: String }) description: string | null;
  @ApiProperty() address: string;
  @ApiProperty({ nullable: true, type: Number }) lat: number | null;
  @ApiProperty({ nullable: true, type: Number }) lng: number | null;
  @ApiProperty({ example: 'Asia/Phnom_Penh' }) timezone: string;
  @ApiProperty() isActive: boolean;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  @ApiProperty({ format: 'date-time' }) updatedAt: string;
}

export class OpeningHourResponseDto {
  @ApiProperty({ description: '0 = Sunday .. 6 = Saturday' }) weekday: number;
  @ApiProperty({ example: '07:00:00' }) openTime: string;
  @ApiProperty({ example: '21:00:00' }) closeTime: string;
  @ApiProperty() closesNextDay: boolean;
}

export class ClosureResponseDto {
  @ApiProperty({ example: '2026-12-25' }) date: string;
  @ApiProperty({ nullable: true, type: String }) reason: string | null;
}

export class BookingPolicyResponseDto {
  @ApiProperty() checkinGraceMinutes: number;
  @ApiProperty() checkoutReminderMinutes: number;
  @ApiProperty() overdueAlertMinutes: number;
  @ApiProperty() minMinutes: number;
  @ApiProperty() maxMinutes: number;
  @ApiProperty() slotMinutes: number;
  @ApiProperty() maxAdvanceDays: number;
  @ApiProperty() maxActivePerUser: number;
  @ApiProperty() maxExtensions: number;
  @ApiProperty() modifyCutoffMinutes: number;
}

export class PlaceDetailResponseDto extends PlaceResponseDto {
  @ApiProperty({ type: [OpeningHourResponseDto] })
  openingHours: OpeningHourResponseDto[];

  @ApiProperty({
    type: [ClosureResponseDto],
    description: 'Closures from today (in the place timezone) onwards',
  })
  closures: ClosureResponseDto[];

  @ApiProperty({ type: BookingPolicyResponseDto, nullable: true })
  bookingPolicy: BookingPolicyResponseDto | null;
}

export class PlacePageResponseDto {
  @ApiProperty({ type: [PlaceResponseDto] }) items: PlaceResponseDto[];
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() total: number;
}

// Explicit copies so internal fields (deletedAt, relations, ids of child rows) never leak.
export function toPlaceResponse(p: Place): PlaceResponseDto {
  return {
    id: p.id,
    name: p.name,
    type: p.type,
    description: p.description,
    address: p.address,
    lat: p.lat,
    lng: p.lng,
    timezone: p.timezone,
    isActive: p.isActive,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export function toPlaceDetailResponse(
  p: Place,
  hours: PlaceOpeningHour[],
  closures: PlaceClosure[],
  policy: BookingPolicy | null,
): PlaceDetailResponseDto {
  return {
    ...toPlaceResponse(p),
    openingHours: hours.map((h) => ({
      weekday: h.weekday,
      openTime: h.openTime,
      closeTime: h.closeTime,
      closesNextDay: h.closesNextDay,
    })),
    closures: closures.map((c) => ({ date: c.date, reason: c.reason })),
    bookingPolicy: policy && {
      checkinGraceMinutes: policy.checkinGraceMinutes,
      checkoutReminderMinutes: policy.checkoutReminderMinutes,
      overdueAlertMinutes: policy.overdueAlertMinutes,
      minMinutes: policy.minMinutes,
      maxMinutes: policy.maxMinutes,
      slotMinutes: policy.slotMinutes,
      maxAdvanceDays: policy.maxAdvanceDays,
      maxActivePerUser: policy.maxActivePerUser,
      maxExtensions: policy.maxExtensions,
      modifyCutoffMinutes: policy.modifyCutoffMinutes,
    },
  };
}
