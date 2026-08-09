/**
 * The school list behind the picker (`E03`, `E14-14`).
 *
 * A parent chooses their child's school before anything else can happen: `AR7` requires
 * the menu be browsable signed out, and a menu read is keyed on a school. This is the one
 * call that has to work before any other read is even meaningful.
 *
 * Backed by `get_schools()` in migration `0011`, which returns onboarded, active schools
 * only (`P1`) and deliberately withholds the school's staff contact details.
 */
import { callRpc } from './client.js';

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
 * Every school a parent may pick, ordered by city then name — the order the database
 * applies, preserved here rather than re-sorted, so the list reads the same everywhere.
 *
 * An empty list is a legitimate answer (no school onboarded yet) and renders as an empty
 * state, not an error.
 */
export async function fetchSchools(): Promise<ApiSchool[]> {
  const data = await callRpc<unknown>('get_schools', {});
  if (data === null || data === undefined) return [];
  if (!Array.isArray(data)) throw new SchoolPayloadError('the response is not an array');

  return data.map((row, i) => {
    if (!isRecord(row) || typeof row.id !== 'string' || typeof row.name !== 'string') {
      throw new SchoolPayloadError(`school ${i} has no id or name`);
    }
    return {
      id: row.id,
      name: row.name,
      city: typeof row.city === 'string' ? row.city : '',
    };
  });
}
