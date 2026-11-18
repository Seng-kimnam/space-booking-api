import { ServiceHttpClient, ServiceHttpError } from './service-http.client';

const response = (status: number, body: unknown = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

function client(responses: (Response | Error)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! });
    const next = responses.shift()!;
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  const sleeps: number[] = [];
  const c = new ServiceHttpClient({
    baseUrl: 'http://lms.local/api/',
    apiKeyHeader: 'x-api-key',
    apiKey: 'secret-key',
    timeoutMs: 5000,
    retries: 2,
    backoffMs: 100,
    userAgent: 'space-booking-api',
    fetchFn,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  return { c, calls, sleeps };
}

describe('ServiceHttpClient', () => {
  it('sends the API key and parses JSON', async () => {
    const { c, calls } = client([response(200, { ok: true })]);
    await expect(c.getJson('/external/places/1/snapshot')).resolves.toEqual({ status: 200, body: { ok: true } });
    expect(calls[0].url).toBe('http://lms.local/api/external/places/1/snapshot');
    expect((calls[0].init.headers as Record<string, string>)['x-api-key']).toBe('secret-key');
  });

  it('retries network errors and 5xx with growing backoff, then succeeds', async () => {
    const { c, calls, sleeps } = client([new TypeError('fetch failed'), response(503), response(200, { n: 1 })]);
    await expect(c.getJson('x')).resolves.toMatchObject({ body: { n: 1 } });
    expect(calls).toHaveLength(3);
    expect(sleeps[0]).toBeGreaterThanOrEqual(100);
    expect(sleeps[1]).toBeGreaterThanOrEqual(200);
  });

  it('does not retry a 401 and never puts the key in the error', async () => {
    const { c, calls } = client([response(401), response(200)]);
    const err = await c.getJson('x').catch((e: unknown) => e as ServiceHttpError);
    expect(err).toBeInstanceOf(ServiceHttpError);
    expect(err).toMatchObject({ status: 401, retryable: false });
    expect(String((err as Error).message)).not.toContain('secret-key');
    expect(calls).toHaveLength(1);
  });

  it('returns null for an accepted status such as 404', async () => {
    const { c } = client([response(404)]);
    await expect(c.getJson('x', [404])).resolves.toEqual({ status: 404, body: null });
  });

  it('gives up after the last retry', async () => {
    const { c, calls } = client([response(500), response(500), response(500)]);
    await expect(c.getJson('x')).rejects.toMatchObject({ status: 500, retryable: true });
    expect(calls).toHaveLength(3);
  });
});
