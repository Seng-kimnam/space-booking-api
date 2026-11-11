import { digestsEqual, generateApiKey, hashSecret, parseApiKey } from './api-key';

describe('api keys', () => {
  it('generates a parseable key whose secret matches the stored hash', () => {
    const { key, prefix, hash } = generateApiKey('test');
    const parsed = parseApiKey(key);
    expect(parsed).toMatchObject({ env: 'test', prefix });
    expect(prefix).toHaveLength(8);
    expect(digestsEqual(hashSecret(parsed!.secret), hash)).toBe(true);
    expect(hash).not.toContain(parsed!.secret);
  });

  it('generates a different key every time', () => {
    expect(generateApiKey('live').key).not.toBe(generateApiKey('live').key);
  });

  it.each([undefined, '', 'Bearer abc', 'sbk_prod_abcdefgh_x', `sbk_live_short_${'a'.repeat(43)}`])(
    'rejects malformed key %p',
    (raw) => expect(parseApiKey(raw)).toBeNull(),
  );

  it('compares digests safely, including different lengths', () => {
    expect(digestsEqual(hashSecret('a'), hashSecret('a'))).toBe(true);
    expect(digestsEqual(hashSecret('a'), hashSecret('b'))).toBe(false);
    expect(digestsEqual(hashSecret('a'), 'abcd')).toBe(false);
    expect(digestsEqual('', '')).toBe(false);
  });
});
