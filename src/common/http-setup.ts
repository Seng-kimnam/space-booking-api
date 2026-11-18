import { INestApplication } from '@nestjs/common';
import helmet from 'helmet';
import { requestIdMiddleware } from './request-context';

/**
 * HTTP middleware shared by main.ts and the e2e app factory
 * (test/utils/create-test-app.ts), so tests run with the same headers.
 * - Request id first, so everything after it (including errors) is tagged.
 * - Helmet security headers. Its Content-Security-Policy is turned off while
 *   Swagger UI is served (non-production): the UI needs inline scripts and
 *   styles that the default policy blocks. The API itself only returns JSON.
 */
export function configureHttp(
  app: INestApplication,
  options: { swaggerEnabled: boolean },
): void {
  app.use(requestIdMiddleware);
  app.use(
    helmet({
      contentSecurityPolicy: options.swaggerEnabled ? false : undefined,
    }),
  );
}
