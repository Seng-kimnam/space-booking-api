import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';

// Raw SQL on purpose: these tests probe the schema, so no entity/ORM defaults in the way.
const uniq = (prefix: string) => `${prefix}-${randomUUID()}`;

export async function insertPlace(
  ds: DataSource,
  overrides: { name?: string; type?: string; address?: string } = {},
): Promise<string> {
  const [row] = await ds.query(
    `INSERT INTO places (name, type, address) VALUES ($1, $2, $3) RETURNING id`,
    [
      overrides.name ?? uniq('place'),
      overrides.type ?? 'LIBRARY',
      overrides.address ?? 'test address',
    ],
  );
  return row.id;
}

export async function insertArea(
  ds: DataSource,
  placeId: string,
  overrides: { name?: string } = {},
): Promise<string> {
  const [row] = await ds.query(
    `INSERT INTO areas (place_id, name) VALUES ($1, $2) RETURNING id`,
    [placeId, overrides.name ?? uniq('area')],
  );
  return row.id;
}

// `table` is only ever a literal from the tests, never user input.
export async function deleteRows(
  ds: DataSource,
  table: string,
  ids: string[],
): Promise<void> {
  if (ids.length)
    await ds.query(`DELETE FROM ${table} WHERE id = ANY($1)`, [ids]);
}
