import { BadRequestException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { PlaceType } from '../common/enums';
import { CreatePlaceDto } from './dto/create-place.dto';
import { toPlaceDetailResponse } from './dto/place.response.dto';
import { UpdatePlaceDto } from './dto/update-place.dto';
import { BookingPolicy } from './entities/booking-policy.entity';
import { Place } from './entities/place.entity';
import {
  assertConsistentPolicy,
  BookingPoliciesService,
} from './services/booking-policies.service';
import {
  assertValidClosures,
  assertValidHours,
  OpeningHoursService,
} from './services/opening-hours.service';
import { PlacesService } from './services/places.service';

const errorsOf = async (cls: new () => object, body: object) =>
  (await validate(plainToInstance(cls, body))).map((e) => e.property);

const validCreate = { name: 'Lib', type: PlaceType.LIBRARY, address: 'St 1' };

describe('place DTOs', () => {
  it('accepts a minimal create body', async () => {
    expect(await errorsOf(CreatePlaceDto, validCreate)).toEqual([]);
  });

  it.each([
    ['offset timezone', { timezone: '+07:00' }],
    ['unknown timezone', { timezone: 'Mars/Olympus' }],
    ['lat out of range', { lat: 91 }],
    [
      'bad hours time',
      { openingHours: [{ weekday: 1, openTime: '8:00', closeTime: '20:00' }] },
    ],
    [
      'weekday 7',
      { openingHours: [{ weekday: 7, openTime: '08:00', closeTime: '20:00' }] },
    ],
    ['closure not a date', { closures: [{ date: '2026-02-30' }] }],
    ['policy negative grace', { policy: { checkinGraceMinutes: -1 } }],
  ])('rejects %s', async (_, extra) => {
    expect(
      (await errorsOf(CreatePlaceDto, { ...validCreate, ...extra })).length,
    ).toBeGreaterThan(0);
  });

  it('accepts IANA timezones', async () => {
    expect(
      await errorsOf(CreatePlaceDto, {
        ...validCreate,
        timezone: 'Asia/Phnom_Penh',
      }),
    ).toEqual([]);
    expect(
      await errorsOf(CreatePlaceDto, { ...validCreate, timezone: 'UTC' }),
    ).toEqual([]);
  });

  it('update: null is rejected on NOT NULL fields and allowed on nullable ones', async () => {
    expect(await errorsOf(UpdatePlaceDto, { name: null })).toEqual(['name']);
    expect(await errorsOf(UpdatePlaceDto, { timezone: null })).toEqual([
      'timezone',
    ]);
    expect(
      await errorsOf(UpdatePlaceDto, {
        description: null,
        lat: null,
        lng: null,
      }),
    ).toEqual([]);
  });
});

describe('opening hours rules', () => {
  const h = (
    weekday: number,
    openTime: string,
    closeTime: string,
    closesNextDay = false,
  ) => ({
    weekday,
    openTime,
    closeTime,
    closesNextDay,
  });

  it('accepts same-day, overnight and 24 h windows', () => {
    expect(() =>
      assertValidHours([
        h(1, '08:00', '20:00'),
        h(5, '18:00', '02:00', true),
        h(6, '00:00', '00:00', true),
      ]),
    ).not.toThrow();
  });

  it.each([
    ['duplicate weekday', [h(1, '08:00', '12:00'), h(1, '13:00', '18:00')]],
    ['close before open', [h(1, '20:00', '08:00')]],
    ['close equals open', [h(1, '08:00', '08:00')]],
    ['overnight longer than 24 h', [h(1, '08:00', '09:00', true)]],
  ])('rejects %s', (_, hours) => {
    expect(() => assertValidHours(hours)).toThrow(BadRequestException);
  });

  it('rejects duplicate closure dates', () => {
    expect(() =>
      assertValidClosures([{ date: '2026-12-25' }, { date: '2026-12-25' }]),
    ).toThrow(BadRequestException);
  });
});

describe('booking policy rules', () => {
  it('rejects max < min and late alert > grace', () => {
    expect(() =>
      assertConsistentPolicy({ minMinutes: 60, maxMinutes: 30 }),
    ).toThrow(BadRequestException);
    expect(() =>
      assertConsistentPolicy({
        checkinGraceMinutes: 5,
        lateCheckinAlertMinutes: 10,
      }),
    ).toThrow(BadRequestException);
  });

  const managerWith = (stored: Partial<BookingPolicy> | null) => {
    const saved: object[] = [];
    const repo = {
      create: (v: object) => v,
      merge: (a: object, b: object) => Object.assign(a, b),
      // A fresh copy per call, like a real DB read.
      findOneBy: async () => (stored ? { ...stored } : null),
      save: async (v: object) => (saved.push(v), v),
    };
    return {
      manager: { getRepository: () => repo } as unknown as EntityManager,
      saved,
    };
  };
  const svc = new BookingPoliciesService({} as DataSource);

  it('create fills defaults and checks the merged row', async () => {
    const { manager, saved } = managerWith(null);
    await svc.create(manager, 'p', { minMinutes: 60 });
    expect(saved[0]).toMatchObject({
      placeId: 'p',
      minMinutes: 60,
      maxMinutes: 240,
      checkinGraceMinutes: 15,
    });
    // 300 min > default max of 240
    await expect(
      svc.create(manager, 'p', { minMinutes: 300 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('update checks a one-sided change against the stored value', async () => {
    const { manager } = managerWith({
      placeId: 'p',
      minMinutes: 30,
      maxMinutes: 120,
      checkinGraceMinutes: 15,
      lateCheckinAlertMinutes: 5,
    });
    await expect(
      svc.update(manager, 'p', { minMinutes: 180 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.update(manager, 'p', { checkinGraceMinutes: 2 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.update(manager, 'p', { maxMinutes: 60, minMinutes: undefined }),
    ).resolves.toMatchObject({ minMinutes: 30, maxMinutes: 60 });
  });
});

describe('PlacesService', () => {
  const dsWith = (place: Place | null, extra: object = {}) =>
    ({
      manager: { getRepository: () => ({ findOneBy: async () => place }) },
      ...extra,
    }) as unknown as DataSource;
  const place = { id: 'p', name: 'Lib', timezone: 'Asia/Phnom_Penh' } as Place;
  const make = (ds: DataSource, policy: BookingPolicy | null = null) =>
    new PlacesService(
      {} as never,
      ds,
      {} as OpeningHoursService,
      { findByPlace: async () => policy } as unknown as BookingPoliciesService,
    );

  it('findVisible / findForAdmin / softDelete throw 404 for a missing place', async () => {
    const svc = make(dsWith(null));
    await expect(svc.findVisible('x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(svc.findForAdmin('x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(svc.softDelete('x')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('getBookingContext returns the policy, 404 without one', async () => {
    const policy = { placeId: 'p' } as BookingPolicy;
    await expect(
      make(dsWith(place), policy).getBookingContext('p'),
    ).resolves.toEqual({
      placeId: 'p',
      name: 'Lib',
      timezone: 'Asia/Phnom_Penh',
      policy,
    });
    await expect(
      make(dsWith(place)).getBookingContext('p'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('maps a CHECK violation in a write to 400', async () => {
    const check = Object.assign(new QueryFailedError('q', [], new Error('x')), {
      driverError: { code: '23514', constraint: 'places_lat_chk' },
    });
    const svc = make(
      dsWith(null, { transaction: async () => Promise.reject(check) }),
    );
    await expect(
      svc.create(validCreate as CreatePlaceDto),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('update throws 404 for a missing place', async () => {
    const manager = { getRepository: () => ({ findOne: async () => null }) };
    const svc = make(
      dsWith(null, {
        transaction: (fn: (m: unknown) => unknown) => fn(manager),
      }),
    );
    await expect(svc.update('x', {})).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('toPlaceDetailResponse', () => {
  it('exposes only public fields and HH:mm times', () => {
    const now = new Date();
    const dto = toPlaceDetailResponse(
      {
        id: 'p',
        name: 'n',
        type: PlaceType.CAFE,
        description: null,
        address: 'a',
        lat: null,
        lng: null,
        timezone: 'UTC',
        isActive: true,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      } as Place,
      [
        {
          id: 'h',
          placeId: 'p',
          weekday: 1,
          openTime: '08:00:00',
          closeTime: '20:00:00',
          closesNextDay: false,
        } as never,
      ],
      [{ id: 'c', placeId: 'p', date: '2026-12-25', reason: null } as never],
      null,
    );
    expect(Object.keys(dto).sort()).toEqual(
      [
        'address',
        'closures',
        'createdAt',
        'description',
        'id',
        'isActive',
        'lat',
        'lng',
        'name',
        'openingHours',
        'policy',
        'timezone',
        'type',
        'updatedAt',
      ].sort(),
    );
    expect(dto.openingHours).toEqual([
      {
        weekday: 1,
        openTime: '08:00',
        closeTime: '20:00',
        closesNextDay: false,
      },
    ]);
    expect(dto.closures).toEqual([{ date: '2026-12-25', reason: null }]);
  });
});
