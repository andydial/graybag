/**
 * Letting the CLI importer's `snapshot()` read through the `api/` module — `E10-29`.
 *
 * `snapshot(db)` in `tools/bulk-import/src/db.mjs` only ever calls `db.from(table).select(cols)`
 * and awaits the result. That is a small enough surface to satisfy from the browser, so the dry
 * run reads the **same columns, in the same order, into the same shape** as the real import —
 * rather than a second reader that would drift from it.
 *
 * ## Why an adapter and not the Supabase client
 *
 * Non-negotiable #1: nothing in `apps/**` may import `@supabase/supabase-js`, and ESLint fails the
 * build if it tries. Every read here goes through `api.runQuery`, so it runs **under the operator's
 * own grants and RLS** — which is also the honest thing for a preview to do. The CLI reads with
 * the service role and sees everything; this sees what the person running it is allowed to see,
 * and a read they lack surfaces as an error rather than as a quietly smaller plan.
 */
import { api } from '@graybag/shared';

/** The `{ data, error }` shape `db.mjs`'s `rows()` destructures after awaiting. */
interface QueryResult {
  data: unknown[] | null;
  error: { message: string } | null;
}

/**
 * A stand-in for a Supabase client, supporting exactly `from(...).select(...)` and nothing else.
 *
 * The returned object is a **thenable**, not a promise: `db.mjs` does `await db.from(x).select(y)`
 * without ever calling `.then` itself, and awaiting a thenable is what makes that work. Errors are
 * resolved rather than thrown, because `rows()` reads `error` off the result and raises its own
 * message naming the table — which is more useful than a bare PostgREST string.
 */
export function snapshotReader() {
  return {
    from(table: string) {
      return {
        select(columns: string) {
          return {
            then(
              resolve: (value: QueryResult) => void,
              reject: (reason: unknown) => void,
            ) {
              api
                .runQuery<unknown>((t: api.ApiTransport) => t.from(table).select(columns))
                .then(
                  (data: unknown[]) => resolve({ data, error: null }),
                  (cause: unknown) =>
                    resolve({
                      data: null,
                      error: {
                        message:
                          cause instanceof Error
                            ? cause.message
                            : `could not read ${table}`,
                      },
                    }),
                )
                .catch(reject);
            },
          };
        },
      };
    },
  };
}
