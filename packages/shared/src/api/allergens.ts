/**
 * The allergen list a parent ticks when adding a child (`E05-01`).
 *
 * A read, so it goes through the Supabase client rather than an Edge Function (`A4`) —
 * `anon_allergen_active` in migration `0012` admits active allergens and nothing else.
 *
 * ## Why the ids matter more than the names here
 *
 * `recipient_allergen` stores allergen **ids**, and so does `dish_allergen`. That shared
 * vocabulary is the entire mechanism behind an allergen warning: the app can only tell a
 * parent "this dish contains something you told us about" because both sides name the same
 * row. A free-text note cannot do that — it reaches the kitchen's packing list and nothing
 * else — which is why the note is offered *alongside* this list and never instead of it.
 *
 * ## Ordering
 *
 * `sort_order` then name, because the list is read by someone scanning for their child's
 * allergen under time pressure and alphabetical is not the order that helps: `is_major`
 * allergens are the ones most likely to be looked for and `sort_order` is where that
 * judgement lives, in data, rather than in a comparator here.
 */
import { runQuery } from './client.js';

export interface ApiAllergen {
  id: string;
  code: string;
  displayName: string;
  /** One of the major declarable allergens. Drives emphasis, never inclusion. */
  isMajor: boolean;
}

/** Raised when the backend returns an allergen list that is not the agreed shape. */
export class AllergenPayloadError extends Error {
  constructor(detail: string) {
    super(`The allergen list is not usable: ${detail}`);
    this.name = 'AllergenPayloadError';
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Exactly what may leave the `allergen` table. Exported so the test can assert it. */
export const ALLERGEN_COLUMNS = 'id,code,display_name,is_major';

export async function fetchAllergens(): Promise<ApiAllergen[]> {
  const rows = await runQuery<unknown>((t) =>
    t.from('allergen').select(ALLERGEN_COLUMNS).order('sort_order'),
  );

  return rows.map((row, i) => {
    if (
      !isRecord(row) ||
      typeof row.id !== 'string' ||
      typeof row.display_name !== 'string'
    ) {
      throw new AllergenPayloadError(`allergen ${i} has no id or display name`);
    }
    return {
      id: row.id,
      code: typeof row.code === 'string' ? row.code : '',
      displayName: row.display_name,
      isMajor: row.is_major === true,
    };
  });
}
