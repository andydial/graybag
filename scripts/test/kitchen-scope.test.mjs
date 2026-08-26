/**
 * What a kitchen operator can actually reach — `E02-35`.
 *
 *   SUPABASE_URL=… SUPABASE_ANON_KEY=… SUPABASE_SERVICE_ROLE_KEY=… SUPABASE_DB_URL=… \
 *     node --test scripts/test/kitchen-scope.test.mjs
 *
 * Andy: *"kitchen staff see only their own kitchen, only child name and allergy badges, and never
 * prices, revenue, parent contact details or another kitchen — prove it with a test through an
 * authenticated client as a kitchen operator, not the service role."*
 *
 * ## Why not pgTAP
 *
 * `authorization.test.sql` is the right place for policy logic and it is excellent at it. It
 * cannot answer this question, because it impersonates by setting `request.jwt.claims` inside a
 * transaction — which proves the policies, and skips the layer where this actually breaks.
 *
 * The failure Andy is describing lives **above** RLS. A policy decides which *rows* a caller may
 * read; it says nothing about which *columns*. So an operator who is correctly denied another
 * kitchen's orders can still be served every money column on their own, and no policy test would
 * notice. This suite therefore goes through PostgREST with a **real signed JWT**, exactly as the
 * kitchen board does.
 *
 * The service role appears only to build the fixture — creating the operator and their grants. No
 * assertion runs through it, because the service role bypasses RLS and would pass everything.
 *
 * ## Read this before changing an assertion
 *
 * One test below asserts a gap rather than a guarantee, and says so loudly. When the column grant
 * that closes it lands, that test **will fail**, and inverting it is the point — it is the
 * forcing function that stops the gap being forgotten. Do not delete it.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

const URL_ = process.env.SUPABASE_URL ?? '';
const ANON = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

/**
 * Skipped rather than failed when there is no stack to talk to.
 *
 * `npm run smoke` runs on every push with no database, and a suite that fails there would be
 * removed within a week. It runs nightly and in the integration workflow, which do have one.
 */
const LIVE = Boolean(URL_ && ANON && SERVICE);

const OPERATOR = 'kitchen.scope.test@example.invalid';

/** The kitchen this operator is granted on. Everything else must be invisible. */
let ownKitchen = '';
let otherKitchen = '';
let token = '';

const rest = (path, tok) =>
  fetch(`${URL_}/rest/v1/${path}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${tok}` },
  });

const asOperator = (path) => rest(path, token);

/**
 * One assertion that always runs, whatever the environment.
 *
 * Without it this file reported `tests 0, pass 0, fail 0` when no stack was configured — a suite
 * that contributes nothing and is indistinguishable from a green one. That is precisely the third
 * outage on Andy's list: *"an entire test suite running zero files."* A skipped suite must say it
 * skipped, in a line somebody can see.
 */
test('the kitchen-scope suite is either running or visibly skipped', () => {
  if (LIVE) {
    assert.ok(URL_ && ANON && SERVICE, 'configured, so the assertions below are real');
    return;
  }
  console.log(
    '# SKIPPED: kitchen-scope needs SUPABASE_URL, SUPABASE_ANON_KEY and ' +
      'SUPABASE_SERVICE_ROLE_KEY. It runs nightly and in the integration workflow.',
  );
  assert.ok(true);
});

describe('a kitchen operator, through an authenticated client', { skip: !LIVE && 'no Supabase stack configured' }, () => {
  before(async () => {
    const admin = (path, init) =>
      fetch(`${URL_}${path}`, {
        ...init,
        headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'content-type': 'application/json', ...(init?.headers ?? {}) },
      });

    // Two kitchens, so "only their own" is a claim with something to exclude.
    const kitchens = await admin('/rest/v1/kitchen?select=id&order=id').then((r) => r.json());
    assert.ok(kitchens.length >= 2, 'this test needs at least two kitchens to mean anything');

    // The operator exists and holds kitchen-scoped grants only. Created through the auth admin
    // API so the JWT below is a real one, signed by GoTrue, exactly like a sign-in.
    await admin('/auth/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify({ email: OPERATOR, email_confirm: true }),
    });

    const link = await admin('/auth/v1/admin/generate_link', {
      method: 'POST',
      body: JSON.stringify({ type: 'magiclink', email: OPERATOR }),
    }).then((r) => r.json());

    const session = await fetch(`${URL_}/auth/v1/verify`, {
      method: 'POST',
      headers: { apikey: ANON, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'magiclink', token_hash: link.hashed_token }),
    }).then((r) => r.json());

    token = session.access_token ?? '';
    assert.ok(token, 'could not sign the operator in — the rest of this suite would be meaningless');

    /*
     * **Own kitchen comes from the grant, not from sort order.**
     *
     * The first version of this took `kitchens[0]` and asserted the operator should see it. The
     * grant happens to be on the kitchen that sorts second, so the suite failed against a system
     * that was behaving perfectly — a test wrong in the direction that cries wolf, which is worse
     * than one that misses, because it is the kind people learn to re-run until it passes.
     */
    const operatorId = (await admin(`/rest/v1/app_user?select=id&email=eq.${OPERATOR}`).then((r) => r.json()))[0]?.id;
    const grants = await admin(
      `/rest/v1/permission_grant?select=scope_type,scope_id&user_id=eq.${operatorId}&revoked_at=is.null`,
    ).then((r) => r.json());

    const scoped = grants.filter((g) => g.scope_type === 'kitchen' && g.scope_id);
    assert.ok(scoped.length > 0, 'the fixture operator holds no kitchen-scoped grant');
    assert.equal(
      new Set(scoped.map((g) => g.scope_id)).size, 1,
      'the fixture operator is granted on more than one kitchen, so "only their own" proves nothing',
    );

    ownKitchen = scoped[0].scope_id;
    otherKitchen = kitchens.map((k) => k.id).find((id) => id !== ownKitchen);
    assert.ok(otherKitchen, 'no second kitchen to be excluded from');
  });

  test('sees orders from their own kitchen and no other', async () => {
    // The failure Andy named first: "a kitchen operator seeing another kitchen's children".
    const rows = await asOperator('order?select=order_ref,kitchen_id&limit=500').then((r) => r.json());
    assert.ok(Array.isArray(rows), 'the operator could not read orders at all');
    assert.ok(rows.length > 0, 'no orders visible — this test would pass vacuously');

    const kitchens = new Set(rows.map((r) => r.kitchen_id));
    assert.equal(kitchens.size, 1, `saw ${kitchens.size} kitchens; an operator must see exactly one`);
    assert.ok(kitchens.has(ownKitchen), 'the one kitchen visible is not the one they are granted on');
  });

  test('cannot reach the other kitchen even by asking for it directly', async () => {
    // Filtering by an id they do not hold must return nothing, not an error and not rows. A
    // policy that only hides rows from an unfiltered list is not a policy.
    const rows = await asOperator(`order?select=order_ref&kitchen_id=eq.${otherKitchen}`).then((r) => r.json());
    assert.deepEqual(rows, [], 'another kitchen’s orders were returned when named explicitly');
  });

  test('sees child names, because the handover needs them', async () => {
    // `orders.view_pii` exists precisely so this is a decision rather than an accident. A board
    // with no names cannot put the right bag in the right hands.
    const rows = await asOperator('order?select=recipient_name_snapshot&limit=20').then((r) => r.json());
    assert.ok(rows.some((r) => r.recipient_name_snapshot), 'no child names — the kitchen board would be unusable');
  });

  test('cannot read any parent’s contact details', async () => {
    // §13.3 rule 4, and `0002` says so in terms: app_user has no kitchen-scoped policy, so the
    // only row an operator can see is their own.
    const rows = await asOperator('app_user?select=email,phone_e164&limit=50').then((r) => r.json());
    const others = rows.filter((r) => r.email !== OPERATOR);
    assert.deepEqual(others, [], 'a kitchen operator can read somebody else’s contact details');
  });

  test('cannot read a guardian link, which would identify a parent indirectly', async () => {
    const rows = await asOperator('guardian_link?select=user_id&limit=20').then((r) => r.json());
    assert.ok(Array.isArray(rows) ? rows.length === 0 : true, 'guardian links are visible to a kitchen operator');
  });

  /**
   * **A GAP, asserted as it currently behaves — `E02-36`.**
   *
   * RLS filters rows, not columns. An operator holding no financial grant is still served every
   * money column on the rows they may see, because PostgREST will return any column the role has
   * `SELECT` on and there is no column-level grant here.
   *
   * The kitchen board never *asks* for these — `KITCHEN_ORDER_COLUMNS` omits them, which is why
   * nothing is visibly wrong today. But that is a convention in one query, not enforcement, and
   * anyone with the operator's token and a URL bar can read the money.
   *
   * Closing it needs `revoke select (…) on "order" from authenticated` plus a grant back to the
   * roles that should have it — DDL, therefore a migration, which this thread does not hold.
   *
   * **When that lands, this test fails.** That is deliberate: invert it to `deepEqual([], …)` and
   * the gap can never quietly reopen.
   */
  test('KNOWN GAP: money columns are readable without a financial grant (E02-36)', async () => {
    const rows = await asOperator('order?select=order_ref,total_paise&limit=5').then((r) => r.json());
    const withMoney = rows.filter((r) => typeof r.total_paise === 'number');
    assert.ok(
      withMoney.length > 0,
      'Money is no longer readable — the column grant has landed. Invert this test to assert ' +
        'that it returns nothing, and close E02-36.',
    );
  });

  after(async () => {
    // The operator is left in place on staging: it is a fixture, and recreating an auth user on
    // every run is slower and noisier than reusing one. It holds three kitchen-scoped grants and
    // can reach nothing else, which is the whole point of the suite above.
  });
});
