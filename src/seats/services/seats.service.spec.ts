import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { QueryFailedError, Repository } from 'typeorm';
import { Seat } from '../entities/seat.entity';
import { SeatStatus } from '../../common/enums';
import { toSeatResponse } from '../dto/seat.response.dto';
import { SeatsService } from './seats.service';

const dbError = (code: string, constraint: string) =>
  Object.assign(new QueryFailedError('q', [], new Error('x')), {
    driverError: { code, constraint },
  });
const repoFailing = (err: unknown) =>
  ({
    create: (v: object) => v,
    save: async () => Promise.reject(err),
    manager: { query: async () => [{}] },
  }) as unknown as Repository<Seat>;

describe('SeatsService', () => {
  it('create maps unique-label violation to 409', async () => {
    await expect(
      new SeatsService(
        repoFailing(dbError('23505', 'seats_place_label_uk')),
      ).create('p', { label: 'A' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('create maps composite FK violation to 400', async () => {
    await expect(
      new SeatsService(
        repoFailing(dbError('23503', 'seats_area_same_place_fk')),
      ).create('p', { label: 'A' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('create rethrows unknown DB errors', async () => {
    const err = dbError('99999', 'other');
    await expect(
      new SeatsService(repoFailing(err)).create('p', { label: 'A' }),
    ).rejects.toBe(err);
  });

  it('create throws 404 when the place is missing and 400 when the area is foreign', async () => {
    const repo = (rows: unknown[]) =>
      ({ manager: { query: async () => rows } }) as unknown as Repository<Seat>;
    await expect(
      new SeatsService(repo([])).create('p', { label: 'A' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    const calls = [[{}], []];
    const r = {
      manager: { query: async () => calls.shift() },
    } as unknown as Repository<Seat>;
    await expect(
      new SeatsService(r).create('p', { label: 'A', areaId: 'a' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('update, setStatus and softDelete throw 404 for an unknown seat', async () => {
    const qb = {
      where: () => qb,
      andWhere: () => qb,
      getOne: async () => null,
    };
    const svc = new SeatsService({
      createQueryBuilder: () => qb,
    } as unknown as Repository<Seat>);
    await expect(svc.update('x', {})).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.setStatus('x', 'ACTIVE' as never)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(svc.softDelete('x')).rejects.toBeInstanceOf(NotFoundException);
  });

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
