import { deathCount } from './death-count';

describe('deathCount', () => {
  it('is 0 without an x-death header', () => {
    expect(deathCount(undefined, 'q')).toBe(0);
    expect(deathCount({}, 'q')).toBe(0);
    expect(deathCount({ 'x-death': 'junk' }, 'q')).toBe(0);
  });

  it('counts only consumer rejects out of the given queue', () => {
    const headers = {
      'x-death': [
        { queue: 'q.retry', reason: 'expired', count: 3 },
        { queue: 'q', reason: 'rejected', count: 3 },
        { queue: 'other', reason: 'rejected', count: 9 },
      ],
    };
    expect(deathCount(headers, 'q')).toBe(3);
  });

  it('accepts counts that arrive as strings or bigints-as-numbers', () => {
    expect(deathCount({ 'x-death': [{ queue: 'q', reason: 'rejected', count: '2' }] }, 'q')).toBe(2);
  });
});
