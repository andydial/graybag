/**
 * The school list behind the picker (`E03`, `E14-14`).
 *
 * A parent chooses their child's school before anything else can happen: `AR7` requires
 * the menu be browsable signed out, and a menu read is keyed on a school. This is the one
 * call that has to work before any other read is even meaningful.
 *
 * Reads `school` directly under the anon policy in migration `0012`, which admits only
 * active, onboarded, not-offboarded schools (`P1`).
 *
 * **The column list is the redaction.** `school` also carries `contact_name`,
 * `contact_email` and `contact_phone` — a named member of staff — plus the address and the
 * kitchen id. A policy filters rows, never columns, so nothing in the database stops
 * `select('*')` here from publishing a staff member's mobile number to anyone holding the
 * anon key. The named list below is the only thing that does, which is why it is spelled
 * out rather than globbed, and why `schools.test.ts` asserts it.
 */
import { runQuery } from './client.js';

export interface ApiSchool {
  id: string;
  name: string;
  /** The city's display name, shown under the school name to disambiguate. */
  city: string;
}

/** Raised when the backend returns a school list that is not the agreed shape. */
export class SchoolPayloadError extends Error {
  constructor(detail: string) {
    super(`The school list is not usable: ${detail}`);
    this.name = 'SchoolPayloadError';
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Every school a parent may pick, ordered by name.
 *
 * An empty list is a legitimate answer (no school onboarded yet) and renders as an empty
 * state, not an error.
 */
/** Exactly what may leave the `school` table. Exported so the test can assert it. */
export const SCHOOL_COLUMNS = 'id,name,city:city_id(name)';

export async function fetchSchools(): Promise<ApiSchool[]> {
  const rows = await runQuery<unknown>((t) =>
    t.from('school').select(SCHOOL_COLUMNS).order('name'),
  );

  return rows.map((row, i) => {
    if (!isRecord(row) || typeof row.id !== 'string' || typeof row.name !== 'string') {
      throw new SchoolPayloadError(`school ${i} has no id or name`);
    }
    // PostgREST returns an embedded to-one relation as a nested object.
    const city = isRecord(row.city) && typeof row.city.name === 'string' ? row.city.name : '';
    return { id: row.id, name: row.name, city };
  });
}
