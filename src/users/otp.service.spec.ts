import { DataSource } from 'typeorm';
import { OtpPurpose } from '../common/enums';
import { OtpService } from './otp.service';

function setup(consumedRows: { user_id: string }[] = []) {
  const queries: [string, unknown[]][] = [];
  const consumeWhere: Record<string, unknown>[] = [];
  const qb = {
    update: () => qb,
    set: () => qb,
    where: (_: string, p: Record<string, unknown>) => (consumeWhere.push(p), qb),
    andWhere: () => qb,
    returning: () => qb,
    execute: async () => ({ raw: consumedRows }),
  };
  const ds = {
    transaction: async (fn: (m: unknown) => Promise<void>) =>
      fn({ query: async (sql: string, params: unknown[]) => void queries.push([sql, params]) }),
    createQueryBuilder: () => qb,
  } as unknown as DataSource;
  return { svc: new OtpService(ds), queries, consumeWhere };
}

describe('OtpService (Telegram link codes)', () => {
  it('issues a t.me-safe code, retires the previous one and stores only its hash', async () => {
    const { svc, queries } = setup();
    const { code, expiresAt } = await svc.issue('u1', OtpPurpose.TELEGRAM_LINK, 10);

    expect(code).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now() + 9 * 60_000);
    expect(queries[0][0]).toContain('SET used_at = now()');
    const [, insertParams] = queries[1];
    expect(insertParams[2]).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(queries)).not.toContain(code);
  });

  it('consumes by hash and returns the user id, or null when nothing matched', async () => {
    const hit = setup([{ user_id: 'u1' }]);
    await expect(hit.svc.consume('abc', OtpPurpose.TELEGRAM_LINK)).resolves.toBe('u1');
    expect(hit.consumeWhere[0].hash).toMatch(/^[0-9a-f]{64}$/);
    await expect(setup([]).svc.consume('abc', OtpPurpose.TELEGRAM_LINK)).resolves.toBeNull();
  });
});
