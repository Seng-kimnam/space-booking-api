import { ApiProperty } from '@nestjs/swagger';

export class TelegramLinkResponseDto {
  @ApiProperty({
    example: 'https://t.me/space_booking_bot?start=Xy3k...',
    description: 'Open it in Telegram and press Start to subscribe.',
  })
  url: string;

  @ApiProperty({ description: 'The link stops working after this time.' })
  expiresAt: Date;
}

export class TelegramStatusResponseDto {
  @ApiProperty()
  linked: boolean;

  @ApiProperty({ type: String, nullable: true, example: 'alice' })
  username: string | null;

  @ApiProperty({ type: Date, nullable: true })
  linkedAt: Date | null;
}
