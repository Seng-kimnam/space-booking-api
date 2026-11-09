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
  @ApiProperty({ example: '08:00' }) openTime: string;
  @ApiProperty({ example: '20:00' }) closeTime: string;
  @ApiProperty() closesNextDay: boolean;
}

export class PlaceClosureResponseDto {
  @ApiProperty({ example: '2026-12-25' }) date: string;
  @ApiProperty({ nullable: true, type: String }) reason: string | null;
}

export class BookingPolicyResponseDto {
  @ApiProperty() checkinGraceMinutes: number;
  @ApiProperty() lateCheckinAlertMinutes: number;
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
  @ApiProperty({
    type: [OpeningHourResponseDto],
    description: 'Sorted by weekday; a missing weekday is closed',
  })
  openingHours: OpeningHourResponseDto[];

  @ApiProperty({
    type: [PlaceClosureResponseDto],
    description: 'Closures from today (place-local date) on',
  })
  closures: PlaceClosureResponseDto[];

  @ApiProperty({ type: BookingPolicyResponseDto, nullable: true })
  policy: BookingPolicyResponseDto | null;
}

export class PlacePageResponseDto {
  @ApiProperty({ type: [PlaceResponseDto] }) items: PlaceResponseDto[];
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() total: number;
}

// Explicit copies so internal fields (deletedAt, relations) never leak.
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

export function toOpeningHourResponse(
  h: PlaceOpeningHour,
): OpeningHourResponseDto {
  // pg returns `time` as 'HH:mm:ss'; input is HH:mm, so output matches it.
  return {
    weekday: h.weekday,
    openTime: h.openTime.slice(0, 5),
    closeTime: h.closeTime.slice(0, 5),
    closesNextDay: h.closesNextDay,
  };
}

export function toPolicyResponse(p: BookingPolicy): BookingPolicyResponseDto {
  return {
    checkinGraceMinutes: p.checkinGraceMinutes,
    lateCheckinAlertMinutes: p.lateCheckinAlertMinutes,
    checkoutReminderMinutes: p.checkoutReminderMinutes,
    overdueAlertMinutes: p.overdueAlertMinutes,
    minMinutes: p.minMinutes,
    maxMinutes: p.maxMinutes,
    slotMinutes: p.slotMinutes,
    maxAdvanceDays: p.maxAdvanceDays,
    maxActivePerUser: p.maxActivePerUser,
    maxExtensions: p.maxExtensions,
    modifyCutoffMinutes: p.modifyCutoffMinutes,
  };
}

export function toPlaceDetailResponse(
  place: Place,
  hours: PlaceOpeningHour[],
  closures: PlaceClosure[],
  policy: BookingPolicy | null,
): PlaceDetailResponseDto {
  return {
    ...toPlaceResponse(place),
    openingHours: hours.map(toOpeningHourResponse),
    closures: closures.map((c) => ({ date: c.date, reason: c.reason })),
    policy: policy ? toPolicyResponse(policy) : null,
  };
}
