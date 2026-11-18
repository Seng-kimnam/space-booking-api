import { ConflictException, NotFoundException } from '@nestjs/common';
import { QueryFailedError, Repository } from 'typeorm';
import { PlacesService } from '../places/services/places.service';
import { toAreaResponse } from './dto/area.dto';
import { Area } from './entities/area.entity';
import { AreasService } from './services/areas.service';

const places = (found: boolean) =>
  ({
    getPlace: async () => {
      if (!found) throw new NotFoundException('Place not found');
      return {};
    },
    getActivePlace: async () => {
      if (!found) throw new NotFoundException('Place not found');
      return {};
    },
  }) as unknown as PlacesService;

const qbReturning = (area: Area | null) => {
  const qb = { innerJoin: () => qb, where: () => qb, getOne: async () => area };
  return qb;
};

describe('AreasService', () => {
  it('create maps the per-place name unique violation to 409', async () => {
    const dup = Object.assign(new QueryFailedError('q', [], new Error('x')), {
      driverError: { code: '23505', constraint: 'areas_place_name_uk' },
    });
    const repo = {
      create: (v: object) => v,
      save: async () => Promise.reject(dup),
    };
    const svc = new AreasService(
      repo as unknown as Repository<Area>,
      places(true),
    );
    await expect(svc.create('p', { name: 'A' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('create and listByPlace throw 404 when the place is missing', async () => {
    const svc = new AreasService({} as Repository<Area>, places(false));
    await expect(svc.create('p', { name: 'A' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      svc.listByPlace('p', { page: 1, limit: 20 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('update and softDelete throw 404 for an unknown area', async () => {
    const repo = { createQueryBuilder: () => qbReturning(null) };
    const svc = new AreasService(
      repo as unknown as Repository<Area>,
      places(true),
    );
    await expect(svc.update('x', {})).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.softDelete('x')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('softDelete returns 409 while seats use the area, and deletes otherwise', async () => {
    const softDelete = jest.fn();
    const repoWith = (seatRows: unknown[]) =>
      ({
        createQueryBuilder: () => qbReturning({ id: 'a' } as Area),
        manager: { query: async () => seatRows },
        softDelete,
      }) as unknown as Repository<Area>;
    await expect(
      new AreasService(repoWith([{}]), places(true)).softDelete('a'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(softDelete).not.toHaveBeenCalled();
    await new AreasService(repoWith([]), places(true)).softDelete('a');
    expect(softDelete).toHaveBeenCalledWith('a');
  });

  it('toAreaResponse exposes exactly the 8 public fields', () => {
    const now = new Date();
    const dto = toAreaResponse({
      id: 'a',
      placeId: 'p',
      name: 'n',
      floor: null,
      description: null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    } as Area);
    expect(Object.keys(dto).sort()).toEqual([
      'createdAt',
      'description',
      'floor',
      'id',
      'isActive',
      'name',
      'placeId',
      'updatedAt',
    ]);
  });
});
