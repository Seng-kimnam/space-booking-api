import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, Matches } from 'class-validator';

export class CreateLinkRequestDto {
  @ApiProperty({ example: '88', description: 'LMS member id (members.id as a string)' })
  @IsString()
  @Matches(/^[0-9A-Za-z_-]{1,64}$/, { message: 'memberId must match [0-9A-Za-z_-]{1,64}' })
  memberId: string;
}

export class LinkRequestResponseDto {
  @ApiProperty({ description: 'One-time code; give it only to the member (it links their account)' })
  code: string;
  @ApiProperty({ type: String, nullable: true, description: 'Our confirm page with the code, if configured' })
  linkUrl: string | null;
  @ApiProperty({ format: 'date-time' }) expiresAt: string;
}

export class ConfirmLinkDto {
  @ApiProperty({ description: 'The code LMS handed to the member' })
  @IsString()
  @Length(16, 64)
  code: string;
}

export class LibraryLinkResponseDto {
  @ApiProperty({ example: 'library' }) system: string;
  @ApiProperty({ example: '88', description: 'LMS member id' }) memberId: string;
  @ApiProperty({ format: 'date-time' }) linkedAt: string;
  @ApiProperty({ type: Boolean, nullable: true, description: 'Latest LMS standing; null = not received yet' })
  eligible: boolean | null;
}
