import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { VALIDATION_PIPE_OPTIONS } from '../../src/common/validation-pipe.options';
import { appConfig } from '../../src/configuration';

// Builds the Nest app for e2e tests, the way main.ts builds it for production.
//
// Why it exists: e2e tests create the app straight from AppModule and never run
// main.ts, so what main.ts sets up would be missing:
// - the `api/v1` global prefix: routes would answer at `/seats` instead of
//   `/api/v1/seats`, so tests would not hit the real URLs;
// - the global ValidationPipe: endpoints without their own pipe (e.g. /auth/*)
//   would skip validation in tests but not in production.
// Both come from the same sources main.ts uses, so the values live in one place.
//
// Usage: `app = await createTestApp()` in beforeAll, `await app.close()` in afterAll.
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix(
    app.get<ConfigType<typeof appConfig>>(appConfig.KEY).globalPrefix,
  );
  app.useGlobalPipes(new ValidationPipe(VALIDATION_PIPE_OPTIONS));
  await app.init();
  return app;
}
