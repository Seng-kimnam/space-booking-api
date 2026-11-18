import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreatePlaceDto } from './create-place.dto';
import { UpdatePlaceDto } from './update-place.dto';

const base = { name: 'Lib', type: 'LIBRARY', address: 'Street 1' };

async function errorsOf<T extends object>(
  cls: new () => T,
  body: object,
): Promise<{ dto: T; props: string[] }> {
  const dto = plainToInstance(cls, body);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  // Flatten nested errors to dotted paths, e.g. openingHours.0.closeTime.
  const props: string[] = [];
  const walk = (es: typeof errors, prefix: string) =>
    es.forEach((e) => {
      const path = prefix + e.property;
      if (e.constraints) props.push(path);
      if (e.children?.length) walk(e.children, `${path}.`);
    });
  walk(errors, '');
  return { dto, props };
}

describe('CreatePlaceDto', () => {
  it('accepts a minimal valid body', async () => {
    expect((await errorsOf(CreatePlaceDto, base)).props).toEqual([]);
  });

  it('trims name/address and canonicalises the timezone', async () => {
    const { dto, props } = await errorsOf(CreatePlaceDto, {
      ...base,
      name: '  Lib  ',
      timezone: 'asia/phnom_penh',
    });
    expect(props).toEqual([]);
    expect(dto.name).toBe('Lib');
    expect(dto.timezone).toBe('Asia/Phnom_Penh');
  });

  it.each(['+07:00', 'UTC+7', 'Nope/Zone', '', 7])(
    'rejects timezone %p',
    async (timezone) => {
      expect(
        (await errorsOf(CreatePlaceDto, { ...base, timezone })).props,
      ).toEqual(['timezone']);
    },
  );

  it('rejects an unknown type and out-of-range coordinates', async () => {
    const { props } = await errorsOf(CreatePlaceDto, {
      ...base,
      type: 'LAB',
      lat: 91,
      lng: -181,
    });
    expect(props.sort()).toEqual(['lat', 'lng', 'type']);
  });

  describe('openingHours', () => {
    const hours = (h: object[]) =>
      errorsOf(CreatePlaceDto, { ...base, openingHours: h });

    it('accepts same-day, overnight and all-day windows', async () => {
      const { props } = await hours([
        { weekday: 1, openTime: '07:00', closeTime: '21:00' },
        {
          weekday: 5,
          openTime: '18:00',
          closeTime: '02:00',
          closesNextDay: true,
        },
        {
          weekday: 6,
          openTime: '00:00',
          closeTime: '00:00',
          closesNextDay: true,
        },
      ]);
      expect(props).toEqual([]);
    });

    it.each([
      [{ weekday: 1, openTime: '21:00', closeTime: '07:00' }, 'closeTime'],
      [{ weekday: 1, openTime: '09:00', closeTime: '09:00' }, 'closeTime'],
      [
        {
          weekday: 1,
          openTime: '18:00',
          closeTime: '20:00',
          closesNextDay: true,
        },
        'closeTime',
      ],
      [{ weekday: 7, openTime: '07:00', closeTime: '21:00' }, 'weekday'],
      [{ weekday: 1, openTime: '24:00', closeTime: '21:00' }, 'openTime'],
      [{ weekday: 1, openTime: '7:00', closeTime: '21:00' }, 'openTime'],
    ])('rejects %j', async (h, prop) => {
      expect((await hours([h])).props).toEqual([`openingHours.0.${prop}`]);
    });

    it('rejects a repeated weekday', async () => {
      const { props } = await hours([
        { weekday: 1, openTime: '07:00', closeTime: '12:00' },
        { weekday: 1, openTime: '13:00', closeTime: '21:00' },
      ]);
      expect(props).toEqual(['openingHours']);
    });
  });

  describe('closures', () => {
    it.each(['2026-02-30', '2026-13-01', '26-12-25', '2026-12-25T00:00:00Z'])(
      'rejects date %p',
      async (date) => {
        const { props } = await errorsOf(CreatePlaceDto, {
          ...base,
          closures: [{ date }],
        });
        expect(props).toEqual(['closures.0.date']);
      },
    );

    it('rejects a repeated date', async () => {
      const { props } = await errorsOf(CreatePlaceDto, {
        ...base,
        closures: [{ date: '2026-12-25' }, { date: '2026-12-25' }],
      });
      expect(props).toEqual(['closures']);
    });
  });

  it('rejects out-of-range policy values and unknown policy fields', async () => {
    const { props } = await errorsOf(CreatePlaceDto, {
      ...base,
      bookingPolicy: { minMinutes: 0, checkinGraceMinutes: -1, bogus: 1 },
    });
    expect(props.sort()).toEqual([
      'bookingPolicy.bogus',
      'bookingPolicy.checkinGraceMinutes',
      'bookingPolicy.minMinutes',
    ]);
  });
});

describe('UpdatePlaceDto', () => {
  it('accepts an empty body (nothing changes)', async () => {
    expect((await errorsOf(UpdatePlaceDto, {})).props).toEqual([]);
  });

  it('allows null only on nullable columns', async () => {
    expect(
      (
        await errorsOf(UpdatePlaceDto, {
          description: null,
          lat: null,
          lng: null,
        })
      ).props,
    ).toEqual([]);
    const { props } = await errorsOf(UpdatePlaceDto, {
      name: null,
      type: null,
      address: null,
      timezone: null,
      isActive: null,
      openingHours: null,
      closures: null,
      bookingPolicy: null,
    });
    expect(props.sort()).toEqual(
      [
        'address',
        'bookingPolicy',
        'closures',
        'isActive',
        'name',
        'openingHours',
        'timezone',
        'type',
      ].sort(),
    );
  });

  it('rejects null inside bookingPolicy', async () => {
    const { props } = await errorsOf(UpdatePlaceDto, {
      bookingPolicy: { maxMinutes: null },
    });
    expect(props).toEqual(['bookingPolicy.maxMinutes']);
  });

  it('accepts [] to clear opening hours and closures', async () => {
    expect(
      (await errorsOf(UpdatePlaceDto, { openingHours: [], closures: [] }))
        .props,
    ).toEqual([]);
  });
});
