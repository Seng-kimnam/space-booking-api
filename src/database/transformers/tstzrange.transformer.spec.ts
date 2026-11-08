import { tstzrangeTransformer } from './tstzrange.transformer';

describe('tstzrangeTransformer', () => {
  const start = new Date('2026-01-01T10:00:00.000Z');
  const end = new Date('2026-01-01T12:00:00.000Z');

  it('writes a half-open [start, end) range in UTC', () => {
    expect(tstzrangeTransformer.to({ start, end })).toBe(
      '[2026-01-01T10:00:00.000Z,2026-01-01T12:00:00.000Z)',
    );
  });

  it('passes null and undefined through', () => {
    expect(tstzrangeTransformer.to(null)).toBeNull();
    expect(tstzrangeTransformer.to(undefined)).toBeUndefined();
    expect(tstzrangeTransformer.from(null)).toBeNull();
  });

  it('reads the format Postgres returns', () => {
    expect(
      tstzrangeTransformer.from(
        '["2026-01-01 10:00:00+00","2026-01-01 12:00:00+00")',
      ),
    ).toEqual({ start, end });
  });

  it('reads non-UTC offsets and fractional seconds', () => {
    expect(
      tstzrangeTransformer.from(
        '["2026-01-01 17:00:00.5+07","2026-01-01 19:00:00+07")',
      ),
    ).toEqual({ start: new Date('2026-01-01T10:00:00.500Z'), end });
  });

  it('rejects empty and unbounded ranges', () => {
    expect(() => tstzrangeTransformer.from('empty')).toThrow();
    expect(() =>
      tstzrangeTransformer.from('["2026-01-01 10:00:00+00",)'),
    ).toThrow();
  });
});
