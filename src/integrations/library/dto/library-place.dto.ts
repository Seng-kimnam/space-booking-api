import { ApiProperty } from '@nestjs/swagger';

export class LibrarySeatMappingDto {
  @ApiProperty({ example: '57', description: 'LMS seat id' }) seatId: string;
  @ApiProperty({ format: 'uuid', description: 'Space Booking seat id' }) sbSeatId: string;
}

/** Same facts as the last place.sync_applied, for LMS to reconcile over HTTP. */
export class LibraryPlaceSyncStatusDto {
  @ApiProperty({ example: '1', description: 'LMS place id' }) placeId: string;
  @ApiProperty({ example: 42, description: 'Last applied snapshot revision' }) revision: number;
  @ApiProperty({ format: 'uuid' }) sbPlaceId: string;
  @ApiProperty({ description: 'Space Booking is_active AND LMS open' }) bookingOpen: boolean;
  @ApiProperty({ type: [LibrarySeatMappingDto] }) seats: LibrarySeatMappingDto[];
}

export class LibraryResyncResponseDto {
  @ApiProperty({ enum: ['applied', 'stale', 'rejected'] }) result: 'applied' | 'stale' | 'rejected';
  @ApiProperty({ required: false, description: 'Rejection code when result = rejected' }) code?: string;
  @ApiProperty({ required: false }) cancelledBookings?: number;
}
