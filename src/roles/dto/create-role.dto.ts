import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateRoleDto {
  @ApiProperty({ example: 'ADMIN', maxLength: 30 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  name: string;
}