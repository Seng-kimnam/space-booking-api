import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { LMS_ID_PATTERN } from '../library.constants';

/** Validates an LMS place id route param. */
@Injectable()
export class LmsIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!LMS_ID_PATTERN.test(value)) throw new BadRequestException('placeId must match [0-9A-Za-z_-]{1,64}');
    return value;
  }
}
