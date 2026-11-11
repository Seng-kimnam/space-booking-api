import { registerAs } from '@nestjs/config';

// Partner integrations (docs/integration/). Each one is off unless enabled, so
// a fresh clone, CI and e2e never consume partner events by accident.
// LMS_API_KEY is a secret: never log it.
export const integrationsConfig = registerAs('integrations', () => ({
  // LMS consumer: place.created / place.updated. Also needs RABBITMQ_URL.
  libraryEnabled: process.env.LIBRARY_INTEGRATION_ENABLED === 'true',
  // LMS REST API for the place repair job (GET /external/places/:id/snapshot).
  // Empty base URL = the repair job does nothing.
  lms: {
    baseUrl: process.env.LMS_BASE_URL ?? '',
    apiKey: process.env.LMS_API_KEY ?? '',
    timeoutMs: Number(process.env.LMS_TIMEOUT_MS ?? 5000),
    retries: 3,
    backoffMs: 500,
  },
}));
