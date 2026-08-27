/**
 * Configuring meal pack offers — `E21-60`.
 *
 * Every write to `meal_pack_offer` and `meal_pack_offer_school`, plus the one read the browser
 * cannot do for itself.
 *
 * ## Why a read lives here too
 *
 * The admin screen must know whether an offer has **already sold packs**, and `meal_pack` has one
 * read policy — `meal_pack_read_own`. A platform admin cannot see other people's packs, correctly:
 * a pack is a purchase, and nobody needs a list of who bought what to price an offer. So the count
 * is computed here, under the service role, and only the count crosses the wire. No owner, no
 * order, no child.
 *
 * ## The rule this function exists to enforce
 *
 * Andy: *"Editing an offer that has already sold must not change terms for packs already bought."*
 *
 * Most of an offer is **stamped onto the pack at sale** — `0068` says so in terms: price, both tax
 * components, the tax point, `meals_total` and `expires_at` are copied at purchase and never
 * re-read. Editing those changes what the *next* buyer gets, which is the entire point of being
 * able to edit an offer.
 *
 * Two fields are not stamped. `meal_pack_balance` (`0072`) joins the live offer for
 * `items_per_meal` and `required_category_id`, so changing either **retroactively changes what an
 * already-bought pack may be spent on** — a parent who bought "2 items, one of them a drink" would
 * silently be holding "3 items, one of them a dessert".
 *
 * So exactly those two are frozen once a pack exists, and everything else stays editable. A
 * blanket "sold offers are immutable" would have been easier to write and wrong: it would block a
 * price correction that harms nobody, and people work around rules that are broader than their
 * reason.
 *
 * The durable fix is to stamp those two on the pack as well, which is a migration and therefore
 * the mobile thread's — `E21-61`. This is enforcement in the meantime, and it belongs here rather
 * than in the browser either way: the form is not the only way a row arrives.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';

import { corsHeaders, preflight } from '../_shared/cors.ts';

const CORS = corsHeaders();
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const int = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) ? v : null;

/** The two fields a sold pack still reads live. See the header. */
const FROZEN_ONCE_SOLD = ['itemsPerMeal', 'requiredCategoryId'] as const;

Deno.serve(async (request: Request): Promise<Response> => {
  const pre = preflight(request, CORS);
  if (pre) return pre;
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const authHeader = request.headers.get('Authorization') ?? '';
  const anon = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: userData, error: userError } = await anon.auth.getUser();
  if (userError || !userData?.user) return json(401, { error: 'not_authenticated' });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'malformed_body' });
  }

  /*
   * `meal_packs.manage` at **platform** scope, and the scope is checked rather than assumed.
   *
   * `0070` constrains the permission's `valid_scope_types` to `{platform}`, so a school-scoped
   * grant cannot be created — but a constraint on what may be granted is not the same as a check
   * on what was. Reading both columns costs nothing and means this holds even if that constraint
   * is ever relaxed.
   */
  const { data: grants, error: grantError } = await anon
    .from('permission_grant')
    .select('permission_code,scope_type')
    .is('revoked_at', null);
  if (grantError) {
    console.error('grant read failed', grantError.code);
    return json(500, { error: 'internal' });
  }

  const permitted = (grants ?? []).some(
    (g: { permission_code: string; scope_type: string }) =>
      g.permission_code === 'meal_packs.manage' && g.scope_type === 'platform',
  );
  if (!permitted) {
    return json(403, { error: 'not_permitted', requires: 'meal_packs.manage at platform scope' });
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  );

  /** How many packs each offer has sold. Counts only — see the header. */
  async function soldByOffer(): Promise<Record<string, number>> {
    const { data, error } = await admin.from('meal_pack').select('offer_id');
    if (error) throw new Error(`sold count failed: ${error.code}`);
    const out: Record<string, number> = {};
    for (const row of data ?? []) {
      const id = String((row as { offer_id: string }).offer_id);
      out[id] = (out[id] ?? 0) + 1;
    }
    return out;
  }

  try {
    // ------------------------------------------------------------------ summary
    if (body.action === 'summary') {
      return json(200, { sold: await soldByOffer() });
    }

    // ------------------------------------------------------------------ create
    if (body.action === 'create') {
      const offer = (body.offer ?? {}) as Record<string, unknown>;
      const fields = validate(offer, { partial: false });
      if ('error' in fields) return json(422, fields.error);

      /*
       * No `is_active` is sent, so the column default (`false`) decides.
       *
       * Andy: *"An offer is off by default — new offers are drafts."* The default is in `0068`;
       * restating `false` here would be a second place to disagree with it.
       */
      const { data, error } = await admin
        .from('meal_pack_offer')
        .insert(fields.row)
        .select('id,name,is_active')
        .single();

      if (error) {
        if (error.code === '23514') {
          // A check constraint. The only one a form can plausibly hit is the discount rule.
          return json(422, {
            error: 'validation_failed',
            fields: { netPricePaise: 'a pack must cost less than the same meals bought singly' },
          });
        }
        if (error.code === '23503') {
          return json(422, { error: 'validation_failed', fields: { requiredCategoryId: 'no such category' } });
        }
        console.error('offer insert failed', error.code);
        return json(500, { error: 'internal' });
      }
      return json(200, { changed: ['offer.created'], offer: data });
    }

    // ------------------------------------------------------------------ update
    if (body.action === 'update') {
      const id = str(body.offerId);
      if (!UUID.test(id)) return json(422, { error: 'validation_failed', fields: { offerId: 'required, and a uuid' } });

      const offer = (body.offer ?? {}) as Record<string, unknown>;
      const fields = validate(offer, { partial: true });
      if ('error' in fields) return json(422, fields.error);

      const sold = (await soldByOffer())[id] ?? 0;
      if (sold > 0) {
        const frozen = FROZEN_ONCE_SOLD.filter((key) => offer[key] !== undefined);
        if (frozen.length > 0) {
          return json(409, {
            error: 'already_sold',
            sold,
            frozen,
            // Named, and with the reason, because "you cannot do that" without a why is what makes
            // somebody go round the outside.
            message:
              `${sold} pack${sold === 1 ? ' has' : 's have'} been bought under this offer. ` +
              `How many items a meal is, and which category one of them must be, are read live ` +
              `when a meal is spent — changing them now would change what those packs can buy. ` +
              `Everything else about the offer is stamped onto a pack when it sells, so it is ` +
              `safe to edit. To change these, make a new offer and withdraw this one.`,
          });
        }
      }

      const { error } = await admin.from('meal_pack_offer').update(fields.row).eq('id', id);
      if (error) {
        if (error.code === '23514') {
          return json(422, {
            error: 'validation_failed',
            fields: { netPricePaise: 'a pack must cost less than the same meals bought singly' },
          });
        }
        console.error('offer update failed', error.code);
        return json(500, { error: 'internal' });
      }
      return json(200, { changed: Object.keys(fields.row).map((c) => `offer.${c}`) });
    }

    // ------------------------------------------------------------------ activate / withdraw
    if (body.action === 'setActive') {
      const id = str(body.offerId);
      const active = body.isActive;
      if (!UUID.test(id)) return json(422, { error: 'validation_failed', fields: { offerId: 'required, and a uuid' } });
      if (typeof active !== 'boolean') {
        return json(422, { error: 'validation_failed', fields: { isActive: 'must be true or false' } });
      }

      const { error } = await admin.from('meal_pack_offer').update({ is_active: active }).eq('id', id);
      if (error) {
        console.error('offer activate failed', error.code);
        return json(500, { error: 'internal' });
      }
      /*
       * Withdrawing does not touch packs already sold, and `0071` is where that is enforced:
       * *"a withdrawn offer must never strand meals already paid for."* This only closes the shop
       * window.
       */
      return json(200, { changed: [active ? 'offer.activated' : 'offer.withdrawn'] });
    }

    // ------------------------------------------------------------------ per-school switch
    if (body.action === 'setSchool') {
      const offerId = str(body.offerId);
      const schoolId = str(body.schoolId);
      const enabled = body.isEnabled;
      if (!UUID.test(offerId) || !UUID.test(schoolId)) {
        return json(422, { error: 'validation_failed', fields: { offerId: 'offerId and schoolId must be uuids' } });
      }
      if (typeof enabled !== 'boolean') {
        return json(422, { error: 'validation_failed', fields: { isEnabled: 'must be true or false' } });
      }

      const { error } = await admin
        .from('meal_pack_offer_school')
        .upsert({ offer_id: offerId, school_id: schoolId, is_enabled: enabled }, { onConflict: 'offer_id,school_id' });
      if (error) {
        if (error.code === '23503') {
          return json(422, { error: 'validation_failed', fields: { schoolId: 'no such school or offer' } });
        }
        console.error('offer school upsert failed', error.code);
        return json(500, { error: 'internal' });
      }
      return json(200, { changed: ['offerSchool.set'] });
    }

    return json(422, {
      error: 'validation_failed',
      fields: { action: 'one of: summary, create, update, setActive, setSchool' },
    });
  } catch (cause) {
    console.error('admin-pack-offer failed', cause instanceof Error ? cause.message : 'unknown');
    return json(500, { error: 'internal' });
  }
});

/**
 * Turn the request's camelCase into the table's snake_case, refusing anything that is not a field.
 *
 * An explicit map rather than a rename-everything loop: a loop would pass through whatever a caller
 * invented, including `is_active`, which has its own action precisely so that activating an offer
 * is a deliberate act and not a side effect of saving a form.
 */
function validate(
  offer: Record<string, unknown>,
  options: { partial: boolean },
): { row: Record<string, unknown> } | { error: Record<string, unknown> } {
  const row: Record<string, unknown> = {};
  const bad: Record<string, string> = {};

  const name = str(offer.name);
  if (offer.name !== undefined || !options.partial) {
    if (!name) bad.name = 'give the offer a name';
    else if (name.length > 80) bad.name = 'at most 80 characters';
    else row.name = name;
  }

  const ints: [string, string, string][] = [
    ['mealsCount', 'meals_count', 'how many meals the pack contains'],
    ['itemsPerMeal', 'items_per_meal', 'how many items make up one meal'],
    ['netPricePaise', 'net_price_paise', 'the price in paise, excluding GST'],
    ['alacarteReferencePaise', 'alacarte_reference_paise', 'what those meals cost singly, in paise'],
    ['validityDays', 'validity_days', 'how many days the pack is valid for'],
  ];
  for (const [from, to, what] of ints) {
    if (offer[from] === undefined && options.partial) continue;
    const value = int(offer[from]);
    if (value === null || value <= 0) bad[from] = `${what} — a whole number above zero`;
    else row[to] = value;
  }

  if (offer.requiredCategoryId !== undefined || !options.partial) {
    const id = str(offer.requiredCategoryId);
    if (!UUID.test(id)) bad.requiredCategoryId = 'choose the category one item must come from';
    else row.required_category_id = id;
  }

  if (Object.keys(bad).length > 0) return { error: { error: 'validation_failed', fields: bad } };
  if (Object.keys(row).length === 0) return { error: { error: 'validation_failed', fields: { offer: 'nothing to change' } } };

  row.updated_at = new Date().toISOString();
  return { row };
}
