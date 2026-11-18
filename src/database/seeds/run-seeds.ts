import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import dataSource from '../data-source';

/**
 * Runs each `seeds/sql/*.sql` file once, in name order, like migrations:
 * a file that already ran (recorded in `seed_history`) is skipped, so
 * `npm run seed` is safe to repeat. The file and its history row commit in one
 * transaction, so a failed seed is retried on the next run.
 * Files stay idempotent anyway (fixed ids + ON CONFLICT), for databases seeded
 * before seed_history existed.
 *
 * Demo data only: refuses to run with NODE_ENV=production.
 * Run migrations first: `npm run migration:run && npm run seed`.
 */
const HISTORY_TABLE = `
  CREATE TABLE IF NOT EXISTS seed_history (
    name       varchar(255) PRIMARY KEY,
    seeded_at  timestamptz  NOT NULL DEFAULT now()
  )`;

async function runSeeds(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Seeds contain demo accounts; refusing to run in production');
  }

  const dir = join(__dirname, 'sql');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  await dataSource.initialize();
  try {
    await dataSource.query(HISTORY_TABLE);
    const done = new Set(
      ((await dataSource.query('SELECT name FROM seed_history')) as { name: string }[]).map(
        (r) => r.name,
      ),
    );

    let ran = 0;
    for (const file of files) {
      if (done.has(file)) {
        console.log(`skip   ${file} (already seeded)`);
        continue;
      }
      const sql = readFileSync(join(dir, file), 'utf8');
      await dataSource.transaction(async (manager) => {
        await manager.query(sql);
        // ON CONFLICT: two runners started at once must not both fail the PK.
        await manager.query(
          'INSERT INTO seed_history (name) VALUES ($1) ON CONFLICT (name) DO NOTHING',
          [file],
        );
      });
      console.log(`seeded ${file}`);
      ran++;
    }
    console.log(ran === 0 ? 'Nothing to seed.' : `Done: ${ran} file(s) seeded.`);
  } finally {
    await dataSource.destroy();
  }
}

runSeeds().catch((err: unknown) => {
  console.error('Seeding failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
