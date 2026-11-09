import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BookingPolicy } from '../entities/booking-policy.entity';

@Injectable()
export class BookingPoliciesService {
  constructor(
    @InjectRepository(BookingPolicy)
    private readonly policies: Repository<BookingPolicy>,
  ) {}

  /** The place's booking limits. Every place gets one on create. */
  async getForPlace(placeId: string): Promise<BookingPolicy> {
    const policy = await this.policies.findOneBy({ placeId });
    if (!policy) throw new NotFoundException('Booking policy not found');
    return policy;
  }
}
