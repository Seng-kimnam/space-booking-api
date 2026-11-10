import { validateEnv } from './env.validation';

const SECRET = 'x'.repeat(32);
const valid = {
  DB_USERNAME: 'postgres',
  DB_PASSWORD: 'postgres',
  DB_NAME: 'space_booking_db',
  JWT_SECRET: SECRET,
};

describe('validateEnv', () => {
  it('accepts the minimal valid env and returns it unchanged', () => {
    expect(validateEnv(valid)).toBe(valid);
  });

  it('accepts typed optional values from strings, as .env provides them', () => {
    expect(() =>
      validateEnv({
        ...valid,
        NODE_ENV: 'production',
        PORT: '3000',
        DB_PORT: '5432',
        JWT_ACCESS_EXPIRES_IN: '1h',
      }),
    ).not.toThrow();
    expect(() =>
      validateEnv({ ...valid, JWT_ACCESS_EXPIRES_IN: '900' }),
    ).not.toThrow();
  });

  it.each([
    ['JWT_SECRET missing', { JWT_SECRET: undefined }, 'JWT_SECRET'],
    ['JWT_SECRET too short', { JWT_SECRET: 'short' }, 'JWT_SECRET'],
    ['DB_NAME missing', { DB_NAME: undefined }, 'DB_NAME'],
    ['DB_USERNAME empty', { DB_USERNAME: '' }, 'DB_USERNAME'],
    [
      'bad expiry',
      { JWT_ACCESS_EXPIRES_IN: '15 minutes' },
      'JWT_ACCESS_EXPIRES_IN',
    ],
    ['bad PORT', { PORT: 'abc' }, 'PORT'],
    ['bad NODE_ENV', { NODE_ENV: 'staging' }, 'NODE_ENV'],
  ])('rejects %s, naming the variable', (_, override, name) => {
    expect(() => validateEnv({ ...valid, ...override })).toThrow(name);
  });

  it('lists every problem at once and never prints the secret value', () => {
    let message = '';
    try {
      validateEnv({ JWT_SECRET: 'tooShortSecretValue' });
    } catch (e) {
      message = (e as Error).message;
    }
    for (const name of ['DB_USERNAME', 'DB_PASSWORD', 'DB_NAME', 'JWT_SECRET'])
      expect(message).toContain(name);
    expect(message).not.toContain('tooShortSecretValue');
  });
});
