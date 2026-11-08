import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { IsUUID, ValidateIf } from 'class-validator';
import { CreateSeatDto } from './create-seat.dto';

export class UpdateSeatDto extends PartialType(
  OmitType(CreateSeatDto, ['areaId']),
) {
  // null clears the area; undefined leaves it unchanged.
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @ValidateIf((o: UpdateSeatDto) => o.areaId !== undefined && o.areaId !== null)
  @IsUUID()
  areaId?: string | null;
}
