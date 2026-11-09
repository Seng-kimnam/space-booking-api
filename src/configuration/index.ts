import { appConfig } from './app.config';
import { authConfig } from './auth.config';
import { bookingConfig } from './booking.config';
import { databaseConfig } from './database.config';
import { loggerConfig } from './logger.config';
import { mailConfig } from './mail.config';
import { redisConfig } from './redis.config';
import { telegramConfig } from './telegram.config';

export {
  appConfig,
  authConfig,
  bookingConfig,
  databaseConfig,
  loggerConfig,
  mailConfig,
  redisConfig,
  telegramConfig,
};
export { isSwaggerEnabled, setupSwagger, SWAGGER_PATH } from './swagger.config';
export { validateEnv } from './env.validation';

export const configurations = [
  appConfig,
  authConfig,
  databaseConfig,
  redisConfig,
  mailConfig,
  loggerConfig,
  telegramConfig,
  bookingConfig,
];
