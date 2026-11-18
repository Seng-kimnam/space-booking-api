import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SchemaValidator } from './schema-validator';
import { CONTRACT, SCHEMA_FILES } from './schemas';

/**
 * The partner copies in docs/integration must never drift from schemas.ts, and
 * every example message we hand out must be valid. If this fails after a
 * schema change, regenerate docs/integration/schemas/*.json from SCHEMA_FILES
 * (one JSON.stringify(schema, null, 2) per file) and fix the fixtures.
 */
const DOCS = join(__dirname, '../../../docs/integration');
const read = (path: string): unknown => JSON.parse(readFileSync(path, 'utf-8'));

interface Fixture {
  routingKey: string;
  properties: Record<string, unknown> & { headers: Record<string, string> };
  body: { id: string; type: string; version: number; source: string; data: unknown };
}

describe('contract files', () => {
  const validator = new SchemaValidator();

  it.each(Object.entries(SCHEMA_FILES))('docs/integration/schemas/%s matches schemas.ts', (file, schema) => {
    expect(read(join(DOCS, 'schemas', file))).toEqual(JSON.parse(JSON.stringify(schema)));
  });

  it('has no schema file in docs that schemas.ts does not define', () => {
    expect(readdirSync(join(DOCS, 'schemas')).sort()).toEqual(Object.keys(SCHEMA_FILES).sort());
  });

  const fixtures = readdirSync(join(DOCS, 'fixtures')).filter((f) => f.endsWith('.json'));

  it('has an example message for every routing key it defines, except the booking.* lifecycle ones covered by the shared schema', () => {
    const keys = new Set(fixtures.map((f) => f.replace(/\.v\d+\.json$/, '')));
    for (const entry of CONTRACT) {
      if (entry.routingKey.startsWith('booking.') && entry.routingKey !== 'booking.alert_due') continue;
      if (entry.routingKey === 'identity.unlinked') continue; // same schema as identity.linked
      expect(keys).toContain(entry.routingKey);
    }
  });

  it.each(fixtures)('fixture %s is a valid message', (file) => {
    const f = read(join(DOCS, 'fixtures', file)) as Fixture;
    const p = f.properties;
    expect(() => validator.assertEnvelope(f.body)).not.toThrow();
    expect(() => validator.assertData(f.body.type, f.body.version, f.body.data)).not.toThrow();
    expect(f.routingKey).toBe(f.body.type);
    expect(p.message_id).toBe(f.body.id);
    expect(p.type).toBe(f.body.type);
    expect(p.app_id).toBe(f.body.source);
    expect(p.user_id).toBe(p.app_id);
    expect(p.headers['x-schema-version']).toBe(String(f.body.version));
  });
});
