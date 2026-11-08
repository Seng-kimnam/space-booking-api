import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import dataSource from '../data-source';

/**
 * Runs every `seeds/sql/*.sql` file in name order, each in its own transaction.
 * Seed files must be idempotent (fixed ids + ON CONFLICT DO NOTHING).
 * Run migrations first: `npm run migration:run && npm run seed`.
 */
async function runSeeds(): Promise<void> {
  const dir = join(__dirname, 'sql');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  await dataSource.initialize();
  try {
    for (const file of files) {
      const sql = readFileSync(join(dir, file), 'utf8');
      await dataSource.transaction((manager) => manager.query(sql));
      console.log(`seeded ${file}`);
    }
  } finally {
    await dataSource.destroy();
  }
}

runSeeds().catch((err: unknown) => {
  console.error('Seeding failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
