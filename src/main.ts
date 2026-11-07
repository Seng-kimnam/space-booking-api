import { NestFactory } from '@nestjs/core';
import { ConfigType } from '@nestjs/config';
import { AppModule } from './app.module';
import { appConfig, isSwaggerEnabled, setupSwagger } from './configuration';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get<ConfigType<typeof appConfig>>(appConfig.KEY);

  app.setGlobalPrefix(config.globalPrefix);

  if (isSwaggerEnabled(config.nodeEnv)) {
    setupSwagger(app);
  }

  await app.listen(config.port);

  console.log(`🚀🚀 Application running: http://localhost:${config.port}`);
  console.log(`📚📚 Swagger UI: http://localhost:${config.port}/api/docs`);
}
bootstrap();
