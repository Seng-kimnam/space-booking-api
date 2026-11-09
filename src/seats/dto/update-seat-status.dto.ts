import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { SeatStatus } from '../../common/enums';

export class UpdateSeatStatusDto {
  @ApiProperty({ enum: SeatStatus, example: SeatStatus.MAINTENANCE })
  @IsEnum(SeatStatus)
  status: SeatStatus;
}
