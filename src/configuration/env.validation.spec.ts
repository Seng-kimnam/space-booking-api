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
    expect(() =>
      validateEnv({ ...valid, MAIL_SECURE: 'true', MAIL_REQUIRE_TLS: 'false' }),
    ).not.toThrow();
    expect(() =>
      validateEnv({
        ...valid,
        RABBITMQ_URL: 'amqp://space-booking:pw@localhost:5672/space-library-dev',
        OUTBOX_RELAY_BATCH: '50',
      }),
    ).not.toThrow();
    expect(() => validateEnv({ ...valid, RABBITMQ_URL: '' })).not.toThrow();
    expect(() =>
      validateEnv({
        ...valid,
        LMS_BASE_URL: 'http://localhost:3002/api',
        LMS_API_KEY: 'k'.repeat(32),
        LIBRARY_INTEGRATION_ENABLED: 'true',
      }),
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
    ['bad MAIL_SECURE', { MAIL_SECURE: 'yes' }, 'MAIL_SECURE'],
    ['bad MAIL_REQUIRE_TLS', { MAIL_REQUIRE_TLS: '1' }, 'MAIL_REQUIRE_TLS'],
    ['bad RABBITMQ_URL scheme', { RABBITMQ_URL: 'http://localhost:5672' }, 'RABBITMQ_URL'],
    ['OUTBOX_RELAY_BATCH out of range', { OUTBOX_RELAY_BATCH: '0' }, 'OUTBOX_RELAY_BATCH'],
    ['bad LMS_BASE_URL', { LMS_BASE_URL: 'ftp://lms' }, 'LMS_BASE_URL'],
    ['LMS_BASE_URL without a key', { LMS_BASE_URL: 'http://localhost:3002/api' }, 'LMS_API_KEY'],
    ['bad LIBRARY_INTEGRATION_ENABLED', { LIBRARY_INTEGRATION_ENABLED: 'yes' }, 'LIBRARY_INTEGRATION_ENABLED'],
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
