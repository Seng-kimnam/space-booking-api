import type { ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import { SortOrder, type SortQuery } from '../dto/pagination-query.dto';
import type { PageResponse } from '../dto/page-response.dto';

interface PageQuery {
  page: number;
  limit: number;
}

/** Rows to skip for `page` (1-based). */
export function pageOffset(query: PageQuery): number {
  return (query.page - 1) * query.limit;
}

/** `{ items, page, limit, total }` with each row mapped to its response DTO. */
export function toPageResponse<T, R>(
  query: PageQuery,
  rows: T[],
  total: number,
  map: (row: T) => R,
): PageResponse<R> {
  return {
    items: rows.map((row) => map(row)),
    page: query.page,
    limit: query.limit,
    total,
  };
}

/**
 * How an endpoint sorts. `columns` maps each allowed `sortBy` to fixed SQL
 * (never user input); several columns sort together in the same direction.
 * `tieBreaker` (usually the id) is always appended ASC so pages are stable.
 */
export interface SortSpec<K extends string> {
  columns: Record<K, string | readonly string[]>;
  default: { sortBy: K; order: SortOrder };
  tieBreaker: string;
}

/**
 * Applies `?sortBy&order`. Without `sortBy` the endpoint's default applies;
 * `order` alone flips the default. A non-default `sortBy` without `order` is ASC.
 */
export function applySort<E extends ObjectLiteral, K extends string>(
  qb: SelectQueryBuilder<E>,
  query: SortQuery<K>,
  spec: SortSpec<K>,
): SelectQueryBuilder<E> {
  const sortBy = query.sortBy ?? spec.default.sortBy;
  const order =
    query.order ??
    (sortBy === spec.default.sortBy ? spec.default.order : SortOrder.ASC);
  const cols = spec.columns[sortBy];
  const list: readonly string[] = typeof cols === 'string' ? [cols] : cols;
  list.forEach((col, i) =>
    i === 0 ? qb.orderBy(col, order) : qb.addOrderBy(col, order),
  );
  return qb.addOrderBy(spec.tieBreaker, 'ASC');
}

/** Escapes `\`, `%` and `_` so user text matches literally in LIKE / ILIKE. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}
