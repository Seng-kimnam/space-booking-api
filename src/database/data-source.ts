import { config } from 'dotenv';
import { join } from 'path';
import { DataSource, DataSourceOptions } from 'typeorm';

// The TypeORM CLI runs outside Nest, so it has to load .env itself.
config({ quiet: true });

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  entities: [join(__dirname, '..', '**', '*.entity.{ts,js}')],
  migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
  migrationsTableName: 'migrations',
  // UUID PKs default to gen_random_uuid() (pgcrypto), matching docs/schema/db.sql,
  // instead of TypeORM's default uuid-ossp extension.
  uuidExtension: 'pgcrypto',
  // Schema changes go through migrations only (AGENTS.md section 6).
  synchronize: false,
};

export default new DataSource(dataSourceOptions);
