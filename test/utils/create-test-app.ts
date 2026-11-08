import { INestApplication } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { appConfig } from '../../src/configuration';

// Builds the Nest app for e2e tests, the way main.ts builds it for production.
//
// Why it exists: e2e tests create the app straight from AppModule and never run
// main.ts, so the `api/v1` global prefix set there would be missing. Routes would
// answer at `/seats` instead of `/api/v1/seats`, and tests would not hit the real URLs.
// The prefix comes from the same appConfig main.ts uses, so the value lives in one place.
//
// Not applied here: the ValidationPipe. Controllers register their own for now, so
// tests exercise the same validation as production. Add a global pipe in both
// main.ts and this helper if one is introduced.
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
  await app.init();
  return app;
}
