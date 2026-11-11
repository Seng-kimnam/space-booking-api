import { AuthCleanupService } from './auth-cleanup.service';

const fakeRepo = (affected: number) => {
  const qb = {
    delete: jest.fn(),
    where: jest.fn(),
    execute: jest.fn().mockResolvedValue({ affected }),
  };
  qb.delete.mockReturnValue(qb);
  qb.where.mockReturnValue(qb);
  return { qb, createQueryBuilder: jest.fn(() => qb) };
};

describe('AuthCleanupService', () => {
  it('deletes OTPs and refresh tokens expired for over a day, and returns the count', async () => {
    const otps = fakeRepo(3);
    const tokens = fakeRepo(4);
    const service = new AuthCleanupService(otps as never, tokens as never);
    const now = new Date('2026-11-10T12:00:00Z');

    await expect(service.purgeExpired(now)).resolves.toBe(7);

    const cutoff = new Date('2026-11-09T12:00:00Z');
    for (const repo of [otps, tokens]) {
      // Only expiry: revoked-but-unexpired tokens stay for reuse detection.
      expect(repo.qb.where).toHaveBeenCalledWith('expires_at < :cutoff', { cutoff });
    }
  });
});
