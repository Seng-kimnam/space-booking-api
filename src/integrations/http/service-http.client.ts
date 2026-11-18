/**
 * Small JSON client for a partner's REST API: API key header, per-attempt
 * timeout, and backoff retries for transient failures (network, 429, 5xx).
 * For background jobs only. Errors never include the key or the full URL.
 */

export interface ServiceHttpOptions {
  /** e.g. http://localhost:3002/api (no trailing slash needed). */
  baseUrl: string;
  /** Header that carries the key, e.g. x-api-key. */
  apiKeyHeader: string;
  apiKey: string;
  /** Per attempt. */
  timeoutMs: number;
  /** Retries after the first attempt. */
  retries: number;
  /** First backoff; doubles each retry, plus jitter. */
  backoffMs: number;
  /** Sent as User-Agent, e.g. space-booking-api. */
  userAgent: string;
  /** Injectable for tests. */
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export class ServiceHttpError extends Error {
  override readonly name = 'ServiceHttpError';
  constructor(
    message: string,
    /** HTTP status, or null when no response came back (network, timeout). */
    readonly status: number | null,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export interface JsonResponse<T> {
  status: number;
  body: T;
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export class ServiceHttpClient {
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: ServiceHttpOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /**
   * GET `path` and parse JSON. Resolves for 2xx and for the statuses in
   * `accept` (e.g. 404 when "not found" is an answer, not an error).
   */
  async getJson<T>(path: string, accept: number[] = []): Promise<JsonResponse<T | null>> {
    const url = this.url(path);
    let lastError: ServiceHttpError | undefined;
    for (let attempt = 0; attempt <= this.options.retries; attempt++) {
      if (attempt > 0) await this.sleep(this.backoff(attempt));
      try {
        const res = await this.fetchFn(url, {
          method: 'GET',
          headers: {
            accept: 'application/json',
            'user-agent': this.options.userAgent,
            [this.options.apiKeyHeader]: this.options.apiKey,
          },
          signal: AbortSignal.timeout(this.options.timeoutMs),
          redirect: 'error',
        });
        if (res.ok) return { status: res.status, body: (await res.json()) as T };
        if (accept.includes(res.status)) return { status: res.status, body: null };
        lastError = new ServiceHttpError(
          `GET ${path} answered ${res.status}`,
          res.status,
          RETRYABLE_STATUS.has(res.status),
        );
        // Drain the body so the connection can be reused.
        await res.body?.cancel().catch(() => undefined);
      } catch (err) {
        const name = err instanceof Error ? err.name : 'Error';
        lastError =
          err instanceof SyntaxError
            ? new ServiceHttpError(`GET ${path} returned invalid JSON`, null, false)
            : new ServiceHttpError(`GET ${path} failed: ${name}`, null, true);
      }
      if (!lastError.retryable) break;
    }
    throw lastError!;
  }

  private url(path: string): string {
    const base = this.options.baseUrl.replace(/\/+$/, '');
    return `${base}/${path.replace(/^\/+/, '')}`;
  }

  private backoff(attempt: number): number {
    const base = this.options.backoffMs * 2 ** (attempt - 1);
    return base + Math.floor(Math.random() * this.options.backoffMs);
  }
}
