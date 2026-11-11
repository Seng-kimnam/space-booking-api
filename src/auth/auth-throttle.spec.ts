import { accountTracker } from './auth-throttle';

describe('accountTracker', () => {
  it('keys on the email, trimmed and lowercased like citext', () => {
    expect(accountTracker({ body: { email: '  User@Example.COM ' }, ip: '1.2.3.4' })).toBe(
      'email:user@example.com',
    );
  });

  it('gives different casings of one email the same key', () => {
    expect(accountTracker({ body: { email: 'A@x.io' } })).toBe(
      accountTracker({ body: { email: 'a@X.IO' } }),
    );
  });

  it('falls back to the IP when the body has no usable email', () => {
    expect(accountTracker({ body: {}, ip: '1.2.3.4' })).toBe('ip:1.2.3.4');
    expect(accountTracker({ body: { email: 42 }, ip: '1.2.3.4' })).toBe('ip:1.2.3.4');
    expect(accountTracker({ ip: '1.2.3.4' })).toBe('ip:1.2.3.4');
  });
});
