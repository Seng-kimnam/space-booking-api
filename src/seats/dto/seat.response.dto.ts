import { PageResponseDto } from '../../common/dto/page-response.dto';
import { ApiProperty } from '@nestjs/swagger';
import { SeatStatus } from '../../common/enums';
import { Seat } from '../entities/seat.entity';

export class SeatResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) placeId: string;
  @ApiProperty({ format: 'uuid', nullable: true }) areaId: string | null;
  @ApiProperty() label: string;
  @ApiProperty({ type: 'object', additionalProperties: true })
  features: Record<string, unknown>;
  @ApiProperty({ enum: SeatStatus }) status: SeatStatus;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  @ApiProperty({ format: 'date-time' }) updatedAt: string;
}

export class SeatPageResponseDto extends PageResponseDto(SeatResponseDto) {}

// Explicit copy so internal fields (deletedAt, relations) never leak.
export function toSeatResponse(seat: Seat): SeatResponseDto {
  return {
    id: seat.id,
    placeId: seat.placeId,
    areaId: seat.areaId,
    label: seat.label,
    features: seat.features,
    status: seat.status,
    createdAt: seat.createdAt.toISOString(),
    updatedAt: seat.updatedAt.toISOString(),
  };
}
