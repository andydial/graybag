// `/kitchen-order-status` — the kitchen moves orders through the lifecycle. `E09-05`, `E09-17`.
//
// **Written by the WEB thread on 2026-08-12**, on Andy's instruction, while the payments thread
// was on `E06`. Only this directory and `packages/shared/src/api/kitchen.ts` were touched, plus
// six export lines in `packages/shared/src/api/index.ts`. **No migration.**
//
//   POST /kitchen-order-status   { orderIds, to, reasonCode? }
//     200 -> { updated: [...], skipped: [...] }
//     400 -> malformed body
//     401 -> no or invalid session
//     403 -> the caller lacks the grant for this transition
//     409 -> an illegal transition; `orderIds` says which
//     422 -> cancelling with no reason
//
// ## It departs from the house shape, and here is why
//
// `checkout` and `recipients` are thin shells over SQL functions — `create_recipient()`,
// `change_recipient_school()` — where every guard and the atomicity live in one transaction in a
// migration. That is the right pattern and this should eventually join it.
//
// It cannot today: a SQL function is a migration, and this thread was told not to touch
// migrations. So the transaction lives here, over a direct connection. The difference matters
// and is not cosmetic — a guard in SQL is enforced against every caller, whereas a guard here is
// enforced only against callers who come through here. **Recommended as a follow-up: move the
// body of `applyStatus` into a `kitchen_set_order_status()` SQL function and make this a shell
// like its neighbours.** Raised as `E09-18`.
//
// ## Why a direct connection rather than PostgREST
//
// `assert_order_status_transition` refuses any status change without `app.actor_type` set, and
// `set local` only means anything inside a transaction. PostgREST runs every request in its own
// transaction, so there is no way to set it from `supabase-js` at all. The same constraint
// `tools/seed-kitchen-day` hit.
//
// ## The thing to be most careful about in this file
//
// **Children's names pass through the rows this touches and none may reach a log line**
// (non-negotiable #4). Nothing below logs a row, a body, or a Postgres message — which can carry
// a value. Failures log the error code and the order ids, both of which are opaque.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import postgres from 'https://deno.land/x/postgresjs@v3.4.4/mod.js';

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/** Which grant each transition needs. `orders.cancel` is separate because cancelling refunds. */
const GRANT_FOR: Record<string, string> = {
  preparing: 'orders.mark_delivered',
  delivered: 'orders.mark_delivered',
  cancelled: 'orders.cancel',
};

/** What the trigger permits from each status, mirroring `order-lifecycle.md` §4.1 for `kitchen`. */
const LEGAL_FROM: Record<string, string[]> = {
  preparing: ['paid'],
  delivered: ['paid', 'preparing'],
  cancelled: ['paid', 'preparing'],
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  // ---------------------------------------------------------------- who is calling
  //
  // Proved from the caller's own JWT and never taken from the body — the shape `checkout` and
  // `recipients` set. A body field naming a user is ignored; there is no code path that reads one.
  const authHeader = request.headers.get('Authorization') ?? '';
  const anon = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: userData, error: userError } = await anon.auth.getUser();
  const user = userData?.user;
  if (userError || !user) return json(401, { error: 'not_authenticated' });

  // ------------------------------------------------------------------------- body
  let body: { orderIds?: unknown; to?: unknown; reasonCode?: unknown };
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'malformed_body' });
  }

  const to = typeof body.to === 'string' ? body.to : '';
  if (!GRANT_FOR[to]) return json(400, { error: 'unknown_target_status' });

  const orderIds = Array.isArray(body.orderIds)
    ? body.orderIds.filter((id): id is string => typeof id === 'string' && UUID.test(id))
    : [];
  if (orderIds.length === 0) return json(400, { error: 'no_order_ids' });
  // A whole school's worth in one call is a mistake, not a use case: one tap marks one class.
  if (orderIds.length > 200) return json(400, { error: 'too_many_orders' });

  const reasonCode = typeof body.reasonCode === 'string' ? body.reasonCode : null;
  // A cancellation without a reason loses *why* the food was not delivered, which is how a
  // refund is later explained. `order-lifecycle.md` forbids `paid -> refunded` directly for
  // exactly this reason.
  if (to === 'cancelled' && !reasonCode) return json(422, { error: 'reason_required' });

  // ------------------------------------------------------------------ authorization
  //
  // Checked here against the caller's own grants, and checked AGAIN by RLS on the read below.
  // This one produces a useful 403; the RLS one is what actually holds.
  const { data: grants, error: grantError } = await anon
    .from('permission_grant')
    .select('permission_code')
    .is('revoked_at', null);

  if (grantError) {
    console.error('grant read failed', grantError.code);
    return json(500, { error: 'internal' });
  }

  const held = new Set((grants ?? []).map((g: { permission_code: string }) => g.permission_code));
  if (!held.has(GRANT_FOR[to])) return json(403, { error: 'not_permitted', requires: GRANT_FOR[to] });

  // --------------------------------------------------------------------- the write
  const sql = postgres(Deno.env.get('SUPABASE_DB_URL') ?? '', { prepare: false, max: 1 });

  try {
    const result = await sql.begin(async (tx) => {
      // `assert_order_status_transition` refuses without this, and `set local` is scoped to the
      // transaction, so it cannot leak into another request on a pooled connection.
      await tx`select set_config('app.actor_type', 'kitchen', true)`;
      await tx`select set_config('app.actor_id', ${user.id}, true)`;

      // Lock the rows we are about to move, so a second tablet marking the same class cannot
      // interleave and produce a half-applied batch.
      const current = await tx`
        select id, status from "order" where id = any(${orderIds}::uuid[]) for update
      `;

      const legalFrom = LEGAL_FROM[to];
      const updated: string[] = [];
      const skipped: string[] = [];
      const illegal: string[] = [];

      for (const row of current) {
        // Idempotent by design: a kitchen tablet on bad wifi retries, and re-marking a delivered
        // order delivered must succeed. The desired state is the desired state.
        if (row.status === to) skipped.push(row.id);
        else if (legalFrom.includes(row.status)) updated.push(row.id);
        else illegal.push(row.id);
      }

      // Partial-safe: the screen computes "outstanding" from data that may be seconds stale, so
      // one already-delivered order must not fail the other twenty-nine. A genuinely illegal
      // move is still refused, and named.
      if (illegal.length > 0) return { illegal };

      if (updated.length > 0) {
        const stampColumn =
          to === 'delivered' ? 'delivered_at' : to === 'preparing' ? 'preparing_at' : 'cancelled_at';

        await tx`
          update "order"
             set status = ${to},
                 ${sql(stampColumn)} = now(),
                 ${to === 'delivered' ? sql`delivered_by_user_id = ${user.id},` : sql``}
                 ${to === 'cancelled' ? sql`cancelled_by_user_id = ${user.id}, cancel_reason_code = ${reasonCode},` : sql``}
                 updated_at = now()
           where id = any(${updated}::uuid[])
        `;
      }

      return { updated, skipped };
    });

    if ('illegal' in result) {
      return json(409, { error: 'illegal_transition', orderIds: result.illegal });
    }
    return json(200, result);
  } catch (cause) {
    // Never echo the database's message: it can quote a column value, and a value here is a
    // child's name. The code is opaque and is all that is logged or returned.
    const code = (cause as { code?: string })?.code ?? 'unknown';
    console.error('kitchen-order-status failed', code, `${orderIds.length} orders`);
    return json(500, { error: 'internal', code });
  } finally {
    await sql.end();
  }
});
