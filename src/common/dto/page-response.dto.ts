import type { Type } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';

/** Plain shape of every list response. */
export interface PageResponse<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}

/**
 * Swagger class for a page of `item`. Subclass it so the schema gets a
 * readable name:
 *
 *   export class SeatPageResponseDto extends PageResponseDto(SeatResponseDto) {}
 */
export function PageResponseDto<T>(item: Type<T>) {
  class PageResponseClass implements PageResponse<T> {
    @ApiProperty({ type: [item] }) items: T[];
    @ApiProperty() page: number;
    @ApiProperty() limit: number;
    @ApiProperty() total: number;
  }
  return PageResponseClass;
}
