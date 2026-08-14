/**
 * A fake PostgREST query builder, for tests.
 *
 * Deliberately **not** exported from `index.ts`: it is test scaffolding, and a fake
 * transport reachable from application code is a fake transport that will eventually be
 * installed by application code.
 *
 * It records what was asked for, so a test can assert the *query* as well as the result —
 * which matters more than usual under `[AUTH-01]`. The column list in `fetchSchools` is the
 * only thing standing between `school.contact_phone` and anyone holding the anon key, and a
 * test that only checks the returned objects would pass just as happily with `select('*')`.
 */
import type { ApiTransport, ProviderError, SelectBuilder, TableRef } from './client.js';

export interface RecordedQuery {
  table: string;
  columns: string;
  filters: { column: string; value: unknown }[];
  /** `IS NULL` / `IS NOT NULL` filters, recorded separately because they are a different SQL operator. */
  isFilters: { column: string; value: null | boolean }[];
  /** `<=` filters. Separate for the same reason: a test asserting a range must see the operator. */
  lteFilters: { column: string; value: unknown }[];
  /** Negated filters — `not('published_at', 'is', null)`. The operator is part of the assertion. */
  notFilters: { column: string; operator: string; value: unknown }[];
  orders: { column: string; ascending: boolean }[];
  /** Row caps asked for, in order. */
  limits: number[];
}

export interface FakeTransport {
  transport: ApiTransport;
  queries: RecordedQuery[];
}

/**
 * Build a transport that answers every query with `rows` (or fails with `error`).
 *
 * One canned answer rather than a per-table map, because every call site in this module
 * makes exactly one query; a test that needs two different answers is a test whose subject
 * has grown a second round trip, and that should be visible.
 */
export function fakeTransport(
  rows: unknown,
  error: ProviderError | null = null,
): FakeTransport {
  const queries: RecordedQuery[] = [];

  const transport: ApiTransport = {
    from(table: string): TableRef {
      return {
        select(columns: string): SelectBuilder {
          const record: RecordedQuery = {
            table,
            columns,
            filters: [],
            isFilters: [],
            lteFilters: [],
            notFilters: [],
            orders: [],
            limits: [],
          };
          queries.push(record);

          const builder: SelectBuilder = {
            eq(column, value) {
              record.filters.push({ column, value });
              return builder;
            },
            is(column, value) {
              record.isFilters.push({ column, value });
              return builder;
            },
            lte(column, value) {
              record.lteFilters.push({ column, value });
              return builder;
            },
            not(column, operator, value) {
              record.notFilters.push({ column, operator, value });
              return builder;
            },
            limit(count) {
              // Recorded, not ignored: `fetchOrders` caps the list and a test must be able to
              // assert that the cap is actually asked for.
              record.limits.push(count);
              return builder;
            },
            order(column, options) {
              record.orders.push({ column, ascending: options?.ascending ?? true });
              return builder;
            },
            then(onfulfilled, onrejected) {
              return Promise.resolve({ data: error ? null : rows, error }).then(
                onfulfilled,
                onrejected,
              );
            },
          };
          return builder;
        },
      };
    },
  };

  return { transport, queries };
}
