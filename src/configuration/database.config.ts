import { registerAs } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { dataSourceOptions } from '../database/data-source';

// Same options as the TypeORM CLI, so the app and migrations never drift apart.
export const databaseConfig = registerAs(
  'database',
  (): TypeOrmModuleOptions => ({ ...dataSourceOptions }),
);
