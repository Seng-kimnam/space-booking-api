import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigType } from '@nestjs/config';
import { AppModule } from './app.module';
import {
  appConfig,
  isSwaggerEnabled,
  loggerConfig,
  setupSwagger,
  SWAGGER_PATH,
} from './configuration';
import { AppLogger } from './logger/app-logger';
import { VALIDATION_PIPE_OPTIONS } from './common/validation-pipe.options';
import { configureHttp } from './common/http-setup';

async function bootstrap() {
  // Buffer startup logs until our logger is attached, so they share its format.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get<ConfigType<typeof appConfig>>(appConfig.KEY);
  const logging = app.get<ConfigType<typeof loggerConfig>>(loggerConfig.KEY);

  app.useLogger(new AppLogger({ json: logging.json, file: logging.file }));
  app.useGlobalPipes(new ValidationPipe(VALIDATION_PIPE_OPTIONS));

  app.setGlobalPrefix(config.globalPrefix);

  const swaggerEnabled = isSwaggerEnabled(config.nodeEnv);
  configureHttp(app, { swaggerEnabled });
  if (swaggerEnabled) {
    setupSwagger(app);
  }

  await app.listen(config.port);

  const logger = new Logger('Bootstrap');
  logger.log(`🚀🚀 Application running: http://localhost:${config.port}`);
  if (swaggerEnabled) {
    logger.log(`📚📚 Swagger UI: http://localhost:${config.port}/${SWAGGER_PATH}`);
  }
}
bootstrap();
