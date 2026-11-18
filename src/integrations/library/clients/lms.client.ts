import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { integrationsConfig } from '../../../configuration/integrations.config';
import { SchemaValidator } from '../../../messaging/contract/schema-validator';
import type { PlaceSnapshotV1 } from '../../../messaging/contract/types';
import { ServiceHttpClient, ServiceHttpError } from '../../http/service-http.client';

/** Calls the LMS REST API with the key LMS issued us (LMS_API_KEY). Background jobs only. */
@Injectable()
export class LmsClient {
  private readonly http: ServiceHttpClient | null;

  constructor(
    @Inject(integrationsConfig.KEY)
    config: ConfigType<typeof integrationsConfig>,
    private readonly schemas: SchemaValidator,
  ) {
    const { baseUrl, apiKey, timeoutMs, retries, backoffMs } = config.lms;
    this.http = baseUrl
      ? new ServiceHttpClient({
          baseUrl,
          apiKey,
          apiKeyHeader: 'x-api-key',
          timeoutMs,
          retries,
          backoffMs,
          userAgent: 'space-booking-api',
        })
      : null;
  }

  isConfigured(): boolean {
    return this.http !== null;
  }

  /**
   * Fetches a place snapshot, checked against the same schema as place.updated.
   * Null when LMS answers 404; throws ServiceHttpError otherwise.
   */
  async getPlaceSnapshot(lmsPlaceId: string): Promise<PlaceSnapshotV1 | null> {
    if (!this.http) throw new Error('LMS_BASE_URL is not configured');
    const res = await this.http.getJson<{ revision?: unknown; data?: unknown }>(
      `external/places/${encodeURIComponent(lmsPlaceId)}/snapshot`,
      [404],
    );
    if (res.body === null) return null;
    const { revision, data } = res.body;
    try {
      this.schemas.assertData('place.updated', 1, data);
    } catch (err) {
      throw new ServiceHttpError(
        `LMS snapshot for place ${lmsPlaceId} is invalid: ${(err as Error).message}`,
        res.status,
        false,
      );
    }
    const snapshot = data as PlaceSnapshotV1;
    if (snapshot.placeId !== lmsPlaceId || (revision !== undefined && revision !== snapshot.revision))
      throw new ServiceHttpError(`LMS snapshot for place ${lmsPlaceId} does not match the request`, res.status, false);
    return snapshot;
  }
}
