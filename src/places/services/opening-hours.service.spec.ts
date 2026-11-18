import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { BookingPolicy } from '../entities/booking-policy.entity';
import { PlaceOpeningHour } from '../entities/place-opening-hour.entity';
import { BookingPoliciesService } from './booking-policies.service';
import { OpeningHoursService } from './opening-hours.service';

// The SQL itself is tested against real Postgres in
// test/e2e/places/places-opening-hours.e2e-spec.ts.
describe('OpeningHoursService', () => {
  const repo = (rows: unknown[]) => {
    const query = jest.fn(async () => rows);
    return {
      repo: { query } as unknown as Repository<PlaceOpeningHour>,
      query,
    };
  };
  const t = (iso: string) => new Date(iso);

  it.each([
    ['empty', '2026-01-05T10:00:00Z', '2026-01-05T10:00:00Z'],
    ['reversed', '2026-01-05T11:00:00Z', '2026-01-05T10:00:00Z'],
  ])('returns false for an %s range without querying', async (_, s, e) => {
    const { repo: r, query } = repo([{ open: true }]);
    expect(
      await new OpeningHoursService(r).isOpenForRange('p', t(s), t(e)),
    ).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });

  it('passes the range as ISO strings and returns the DB answer', async () => {
    const { repo: r, query } = repo([{ open: true }]);
    const s = '2026-01-05T03:00:00.000Z';
    const e = '2026-01-05T05:00:00.000Z';
    expect(
      await new OpeningHoursService(r).isOpenForRange('p', t(s), t(e)),
    ).toBe(true);
    expect(query).toHaveBeenCalledWith(expect.any(String), ['p', s, e]);
  });

  it('treats a missing row as closed', async () => {
    const { repo: r } = repo([]);
    expect(
      await new OpeningHoursService(r).isOpenForRange(
        'p',
        t('2026-01-05T03:00:00Z'),
        t('2026-01-05T05:00:00Z'),
      ),
    ).toBe(false);
  });
});

describe('BookingPoliciesService', () => {
  it('returns the policy or 404s', async () => {
    const policy = { placeId: 'p' } as BookingPolicy;
    const found = {
      findOneBy: async () => policy,
    } as unknown as Repository<BookingPolicy>;
    expect(await new BookingPoliciesService(found).getForPlace('p')).toBe(
      policy,
    );
    const missing = {
      findOneBy: async () => null,
    } as unknown as Repository<BookingPolicy>;
    await expect(
      new BookingPoliciesService(missing).getForPlace('p'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
