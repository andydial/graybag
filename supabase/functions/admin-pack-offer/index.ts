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
 * ## The rule this function existed to enforce, and why it no longer needs to
 *
 * Andy: *"Editing an offer that has already sold must not change terms for packs already bought."*
 *
 * The old design froze `itemsPerMeal` and `requiredCategoryId` once an offer had sold, because
 * `meal_pack_balance` joined the live offer for them — so editing either **retroactively changed
 * what an already-bought pack could buy**. `E21-67` found a third: `name` was joined live too, and
 * reached a tax invoice.
 *
 * **`E21-78` removes the reason instead of the freeze.** Every figure a pack is sold on is now
 * STAMPED onto the pack row at purchase: the name, the price, both tax components, the item
 * count, the bonus count and window, and both dates. `start_meal_pack_purchase` copies them and
 * nothing re-reads the offer afterwards. Neither of the two frozen columns exists any more — one
 * item is one item, with no price cap and no category — and the one that replaced them in spirit,
 * the name, is stamped.
 *
 * So an offer is **fully editable for ever**, and that is a stronger guarantee than the freeze
 * was, not a weaker one: the freeze protected two columns by convention and missed a third,
 * whereas a snapshot protects everything by construction. `meal_packs.test.sql` proves it by
 * renaming an offer after a sale and asserting the pack does not follow.
 *
 * What this function still owes is the permission (`meal_packs.manage` at platform scope) and
 * validation, and it belongs here rather than in the browser: the form is not the only way a row
 * arrives.
 *
 * **Ownership**: MOBILE owns this file, confirmed by Andy 2026-09-16 — *"You're rewriting the
 * schema under it, so the function follows the schema."* WEB consumes it and files requirements
 * against it rather than editing it.
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
        // NOTHING IS FROZEN ANY MORE. `E21-78` stamps every figure onto the pack at sale, so
        // editing an offer cannot reach a pack already bought. `sold` is still read and still
        // returned, because a screen editing an offer that 40 families have bought should say so
        // — that is information, not a refusal.
      }

      const { error } = await admin.from('meal_pack_offer').update(fields.row).eq('id', id);
      if (error) {
        if (error.code === '23514') {
          // A check constraint refused it. The named cases are caught above with a field; this is
          // the backstop, and it says which rules exist rather than guessing which one fired.
          return json(422, {
            error: 'validation_failed',
            fields: {
              offer:
                'the offer breaks one of its rules — price, item count and validity must be ' +
                'above zero, and the bonus needs an item count and a window together or neither',
            },
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

  // Must be above zero.
  const positiveInts: [string, string, string][] = [
    ['itemsCount', 'items_count', 'how many items the pack contains'],
    ['netPricePaise', 'net_price_paise', 'the price in paise, excluding GST'],
    ['validityDays', 'validity_days', 'how many days the pack is valid for'],
  ];
  for (const [from, to, what] of positiveInts) {
    if (offer[from] === undefined && options.partial) continue;
    const value = int(offer[from]);
    if (value === null || value <= 0) bad[from] = `${what} — a whole number above zero`;
    else row[to] = value;
  }

  // May be zero — an offer with no bonus is a perfectly good offer.
  const zeroOrMore: [string, string, string][] = [
    ['bonusItemsCount', 'bonus_items_count', 'how many free items the bonus adds'],
    ['bonusWindowDays', 'bonus_window_days', 'how many days to use the pack in to earn the bonus'],
  ];
  for (const [from, to, what] of zeroOrMore) {
    if (offer[from] === undefined && options.partial) continue;
    const value = int(offer[from]);
    if (value === null || value < 0) bad[from] = `${what} — a whole number, zero or above`;
    else row[to] = value;
  }

  /**
   * The two bonus fields are only meaningful together, and the database refuses the incoherent
   * pair (`meal_pack_offer_bonus_is_coherent`). Caught here as well so the admin gets a named
   * field rather than a constraint name — a bonus window with no items reads to a parent as a
   * promise of nothing, which is worse than no bonus at all.
   *
   * Checked only when both are known: a partial edit that touches one reads the other from the
   * row it is about to change, which this function does not hold, so the database is left to be
   * the backstop it already is.
   */
  const bonusItems = row.bonus_items_count as number | undefined;
  const bonusWindow = row.bonus_window_days as number | undefined;
  if (bonusItems !== undefined && bonusWindow !== undefined) {
    if (bonusItems === 0 && bonusWindow > 0) {
      bad.bonusItemsCount = 'a bonus window with no bonus items promises nothing — set both or neither';
    } else if (bonusItems > 0 && bonusWindow === 0) {
      bad.bonusWindowDays = 'bonus items need a window to be earned in — set both or neither';
    } else if (bonusWindow > 0 && row.validity_days !== undefined
               && bonusWindow > (row.validity_days as number)) {
      bad.bonusWindowDays = 'the bonus window cannot outlive the pack';
    }
  }

  if (Object.keys(bad).length > 0) return { error: { error: 'validation_failed', fields: bad } };
  if (Object.keys(row).length === 0) return { error: { error: 'validation_failed', fields: { offer: 'nothing to change' } } };

  row.updated_at = new Date().toISOString();
  return { row };
}
