import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SchemaValidator } from '../../../messaging/contract/schema-validator';
import { LmsClient } from './lms.client';

const snapshot = (
  JSON.parse(
    readFileSync(join(__dirname, '../../../../docs/integration/fixtures/place.updated.v1.json'), 'utf-8'),
  ) as { body: { data: { placeId: string; revision: number } } }
).body.data;

const config = (baseUrl: string) =>
  ({
    libraryEnabled: true,
    lms: { baseUrl, apiKey: 'k'.repeat(32), timeoutMs: 1000, retries: 0, backoffMs: 1 },
  }) as never;

describe('LmsClient', () => {
  const fetchSpy = jest.spyOn(global, 'fetch');
  afterEach(() => fetchSpy.mockReset());
  afterAll(() => fetchSpy.mockRestore());

  it('is off without LMS_BASE_URL', () => {
    expect(new LmsClient(config(''), new SchemaValidator()).isConfigured()).toBe(false);
  });

  it('fetches and validates a place snapshot with the API key', async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ revision: snapshot.revision, data: snapshot })));
    const client = new LmsClient(config('http://lms.local/api'), new SchemaValidator());
    await expect(client.getPlaceSnapshot('1')).resolves.toMatchObject({ placeId: '1' });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe('http://lms.local/api/external/places/1/snapshot');
    expect((init!.headers as Record<string, string>)['x-api-key']).toBe('k'.repeat(32));
  });

  it('returns null on 404 and rejects an invalid or mismatched snapshot', async () => {
    const client = new LmsClient(config('http://lms.local/api'), new SchemaValidator());
    fetchSpy.mockResolvedValueOnce(new Response('{}', { status: 404 }));
    await expect(client.getPlaceSnapshot('1')).resolves.toBeNull();
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ revision: 1, data: { placeId: '1' } })));
    await expect(client.getPlaceSnapshot('1')).rejects.toThrow('invalid');
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ revision: snapshot.revision, data: snapshot })));
    await expect(client.getPlaceSnapshot('2')).rejects.toThrow('does not match');
  });
});
