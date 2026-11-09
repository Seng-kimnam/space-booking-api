import { appConfig } from './app.config';
import { bookingConfig } from './booking.config';
import { databaseConfig } from './database.config';
import { loggerConfig } from './logger.config';
import { mailConfig } from './mail.config';
import { redisConfig } from './redis.config';
import { telegramConfig } from './telegram.config';

export {
  appConfig,
  bookingConfig,
  databaseConfig,
  loggerConfig,
  mailConfig,
  redisConfig,
  telegramConfig,
};
export { isSwaggerEnabled, setupSwagger, SWAGGER_PATH } from './swagger.config';

export const configurations = [
  appConfig,
  databaseConfig,
  redisConfig,
  mailConfig,
  loggerConfig,
  telegramConfig,
  bookingConfig,
];
