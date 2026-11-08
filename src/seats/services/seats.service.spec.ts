import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { Seat } from '../entities/seat.entity';
import { SeatStatus } from '../../common/enums';
import { toSeatResponse } from '../dto/seat.response.dto';
import { SeatsService } from './seats.service';

describe('SeatsService', () => {
  it('findOne throws 404 when the seat is not visible', async () => {
    const qb = {
      where: () => qb,
      andWhere: () => qb,
      getOne: async () => null,
    };
    const repo = {
      createQueryBuilder: () => qb,
    } as unknown as Repository<Seat>;
    await expect(new SeatsService(repo).findOne('x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('toSeatResponse exposes exactly the 8 DTO keys', () => {
    const now = new Date();
    const dto = toSeatResponse({
      id: 'i',
      placeId: 'p',
      areaId: null,
      label: 'A1',
      features: {},
      status: SeatStatus.ACTIVE,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    } as Seat);
    expect(Object.keys(dto).sort()).toEqual([
      'areaId',
      'createdAt',
      'features',
      'id',
      'label',
      'placeId',
      'status',
      'updatedAt',
    ]);
  });
});
