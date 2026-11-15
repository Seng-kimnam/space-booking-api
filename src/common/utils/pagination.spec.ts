import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  SortablePaginationQueryDto,
  SortOrder,
} from '../dto/pagination-query.dto';
import {
  applySort,
  escapeLike,
  pageOffset,
  type SortSpec,
  toPageResponse,
} from './pagination';

type Field = 'name' | 'createdAt';

const spec: SortSpec<Field> = {
  columns: { name: ['t.group', 't.name'], createdAt: 't.createdAt' },
  default: { sortBy: 'name', order: SortOrder.ASC },
  tieBreaker: 't.id',
};

/** Records orderBy / addOrderBy calls in order. */
function fakeQb() {
  const calls: Array<[string, string]> = [];
  const qb = {
    calls,
    orderBy: jest.fn((col: string, dir: string) => {
      calls.length = 0;
      calls.push([col, dir]);
      return qb;
    }),
    addOrderBy: jest.fn((col: string, dir: string) => {
      calls.push([col, dir]);
      return qb;
    }),
  };
  return qb;
}

describe('pagination utils', () => {
  it('pageOffset is (page - 1) * limit', () => {
    expect(pageOffset({ page: 1, limit: 20 })).toBe(0);
    expect(pageOffset({ page: 3, limit: 25 })).toBe(50);
  });

  it('toPageResponse maps rows and echoes page/limit/total', () => {
    expect(
      toPageResponse({ page: 2, limit: 2 }, [1, 2], 7, (n) => `#${n}`),
    ).toEqual({ items: ['#1', '#2'], page: 2, limit: 2, total: 7 });
  });

  it('escapeLike makes %, _ and \\ literal', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
  });

  describe('applySort', () => {
    it('uses the default sort, then the tie-breaker', () => {
      const qb = fakeQb();
      applySort(qb as never, {}, spec);
      expect(qb.calls).toEqual([
        ['t.group', 'ASC'],
        ['t.name', 'ASC'],
        ['t.id', 'ASC'],
      ]);
    });

    it('order alone flips the default sort', () => {
      const qb = fakeQb();
      applySort(qb as never, { order: SortOrder.DESC }, spec);
      expect(qb.calls).toEqual([
        ['t.group', 'DESC'],
        ['t.name', 'DESC'],
        ['t.id', 'ASC'],
      ]);
    });

    it('a non-default sortBy is ASC unless order is given', () => {
      const asc = fakeQb();
      applySort(asc as never, { sortBy: 'createdAt' }, spec);
      expect(asc.calls).toEqual([
        ['t.createdAt', 'ASC'],
        ['t.id', 'ASC'],
      ]);

      const desc = fakeQb();
      applySort(
        desc as never,
        { sortBy: 'createdAt', order: SortOrder.DESC },
        spec,
      );
      expect(desc.calls[0]).toEqual(['t.createdAt', 'DESC']);
    });
  });

  describe('SortablePaginationQueryDto', () => {
    class Query extends SortablePaginationQueryDto(
      ['name', 'createdAt'] as const,
      'name',
    ) {}
    const errorsFor = (plain: object) =>
      validateSync(plainToInstance(Query, plain)).map((e) => e.property);

    it('accepts allowlisted sortBy and both orders, with page defaults', () => {
      const q = plainToInstance(Query, { sortBy: 'createdAt', order: 'DESC' });
      expect(validateSync(q)).toEqual([]);
      expect(q).toMatchObject({ page: 1, limit: 20 });
    });

    it('rejects a sortBy outside the allowlist (no raw column names)', () => {
      expect(errorsFor({ sortBy: 'password_hash' })).toEqual(['sortBy']);
      expect(errorsFor({ sortBy: 'name; DROP TABLE x' })).toEqual(['sortBy']);
    });

    it('rejects an unknown order and out-of-range paging', () => {
      expect(errorsFor({ order: 'sideways' })).toEqual(['order']);
      expect(errorsFor({ page: '0', limit: '101' }).sort()).toEqual([
        'limit',
        'page',
      ]);
    });
  });
});
