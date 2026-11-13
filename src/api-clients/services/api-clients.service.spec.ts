import { ConflictException } from '@nestjs/common';
import { QueryFailedError, Repository } from 'typeorm';
import { generateApiKey } from '../api-key';
import { ApiClient } from '../entities/api-client.entity';
import { ApiClientsService } from './api-clients.service';

function service(rows: Partial<ApiClient>[] = [], saveError?: unknown) {
  const executed: string[] = [];
  const qb = {
    update() { return this; },
    set() { return this; },
    where() { return this; },
    andWhere() { return this; },
    execute: async () => { executed.push('touch'); },
  };
  const repo = {
    find: jest.fn(async ({ where }: { where: { keyPrefix: string; isActive: boolean } }) =>
      rows.filter((r) => r.keyPrefix === where.keyPrefix && r.isActive === where.isActive),
    ),
    create: (v: Partial<ApiClient>) => ({ ...v }),
    save: jest.fn(async (v: Partial<ApiClient>) => {
      if (saveError) throw saveError;
      return { id: 'c-new', isActive: true, lastUsedAt: null, createdAt: new Date(), ...v };
    }),
    createQueryBuilder: () => qb,
  } as unknown as Repository<ApiClient>;
  const svc = new ApiClientsService(repo, { nodeEnv: 'production' } as never);
  return { svc, repo, executed };
}

describe('ApiClientsService', () => {
  it('creates a live key in production, returns it once and stores only the hash', async () => {
    const { svc, repo } = service();
    const created = await svc.create({ name: 'LMS', scopes: ['places:read'] });
    expect(created.apiKey).toMatch(/^sbk_live_/);
    const saved = (repo.save as jest.Mock).mock.calls[0][0] as ApiClient;
    expect(saved.apiKeyHash).toHaveLength(64);
    expect(JSON.stringify(saved)).not.toContain(created.apiKey.split('_').pop()!);
    expect(created).not.toHaveProperty('apiKeyHash');
  });

  it('maps a duplicate name to 409', async () => {
    const dup = Object.assign(new QueryFailedError('q', [], new Error('x')), {
      driverError: { code: '23505', constraint: 'api_clients_name_uk' },
    });
    await expect(service([], dup).svc.create({ name: 'LMS', scopes: [] })).rejects.toThrow(ConflictException);
  });

  it('authenticates the right key and records use', async () => {
    const key = generateApiKey('live');
    const { svc, executed } = service([
      { id: 'c1', name: 'LMS', keyPrefix: key.prefix, apiKeyHash: key.hash, isActive: true, scopes: ['places:read'] },
    ]);
    await expect(svc.authenticate(key.key)).resolves.toEqual({ id: 'c1', name: 'LMS', scopes: ['places:read'] });
    expect(executed).toEqual(['touch']);
  });

  it('returns null for a wrong secret, an inactive client or a malformed key', async () => {
    const key = generateApiKey('live');
    const other = generateApiKey('live');
    const row = { id: 'c1', name: 'LMS', keyPrefix: key.prefix, apiKeyHash: key.hash, scopes: [] };
    const wrong = key.key.replace(/_[^_]+$/, `_${other.key.split('_').pop()}`);
    await expect(service([{ ...row, isActive: true }]).svc.authenticate(wrong)).resolves.toBeNull();
    await expect(service([{ ...row, isActive: false }]).svc.authenticate(key.key)).resolves.toBeNull();
    await expect(service([{ ...row, isActive: true }]).svc.authenticate('nope')).resolves.toBeNull();
  });
});
