import { PageResponseDto } from '../../common/dto/page-response.dto';
import { ApiProperty } from '@nestjs/swagger';
import { Role } from '../entities/role.entity';

export class RoleResponseDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'MANAGER' })
  name: string;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt: string;

  // Explicit copy so the response never follows entity changes by accident.
  static from(role: Role): RoleResponseDto {
    const dto = new RoleResponseDto();
    dto.id = role.id;
    dto.name = role.name;
    dto.createdAt = role.createdAt.toISOString();
    dto.updatedAt = role.updatedAt.toISOString();
    return dto;
  }
}

export class RolePageResponseDto extends PageResponseDto(RoleResponseDto) {}
