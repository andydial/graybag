/**
 * School onboarding and editing — `E10-01`.
 *
 * Reads go through PostgREST under RLS; **the writes go through the `admin-school` Edge
 * Function** (`A4`, non-negotiable #1). ESLint enforces the second half.
 *
 * ## Why this is not `schools.ts`
 *
 * `schools.ts` is the parent-facing picker: three columns, readable signed out under `0012`, and
 * the column list *is* the redaction — `school` also carries a named member of staff and their
 * direct line. This module reads all of it, for somebody holding `school.edit`. Two modules with
 * two column lists means the parent-facing path cannot leak a contact by mistake: the columns are
 * not in the query it sends. The same reasoning that keeps `admin-orders.ts` separate from
 * `kitchen.ts`.
 */
import { invokeFunction, runQuery } from './client.js';

export interface AdminSchool {
  id: string;
  code: string;
  name: string;
  cityName: string;
  kitchenId: string;
  kitchenName: string;
  institutionType: string;
  addressLine1: string | null;
  addressLine2: string | null;
  postcode: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  isActive: boolean;
  /** Null means never onboarded — the school does not appear in the parent-facing picker (`P1`). */
  onboardedAt: string | null;
}

export class AdminSchoolError extends Error {
  constructor(detail: string) {
    super(`The school list is not usable: ${detail}`);
    this.name = 'AdminSchoolError';
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/**
 * Everything the admin list shows.
 *
 * Spelled out rather than globbed, for the reason `SCHOOL_COLUMNS` is: a policy filters rows,
 * never columns. This one is deliberately wider — it includes the contact — and being able to see
 * the two lists side by side is what makes that widening a decision rather than an accident.
 */
export const ADMIN_SCHOOL_COLUMNS =
  'id,code,name,institution_type,address_line1,address_line2,postcode,' +
  'contact_name,contact_email,contact_phone,is_active,onboarded_at,' +
  'kitchen_id,city:city_id(name),kitchen:kitchen_id(name)';

export async function fetchAdminSchools(): Promise<AdminSchool[]> {
  const rows = await runQuery<unknown>((t) =>
    t.from('school').select(ADMIN_SCHOOL_COLUMNS).order('name'),
  );

  return rows.map((row, i) => {
    if (!isRecord(row)) throw new AdminSchoolError(`row ${i} is not an object`);
    const id = str(row.id);
    const code = str(row.code);
    if (!id || !code) throw new AdminSchoolError(`row ${i} has no id or code`);

    // PostgREST returns an embedded to-one relation as a nested object.
    const city = isRecord(row.city) ? str(row.city.name) : null;
    const kitchen = isRecord(row.kitchen) ? str(row.kitchen.name) : null;

    return {
      id,
      code,
      name: str(row.name) ?? '',
      cityName: city ?? '',
      kitchenId: str(row.kitchen_id) ?? '',
      kitchenName: kitchen ?? '',
      institutionType: str(row.institution_type) ?? 'school',
      addressLine1: str(row.address_line1),
      addressLine2: str(row.address_line2),
      postcode: str(row.postcode),
      contactName: str(row.contact_name),
      contactEmail: str(row.contact_email),
      contactPhone: str(row.contact_phone),
      isActive: row.is_active !== false,
      onboardedAt: str(row.onboarded_at),
    };
  });
}

export interface Kitchen {
  id: string;
  code: string;
  name: string;
}

export interface City {
  id: string;
  code: string;
  name: string;
}

/** The kitchens a school may be assigned to. */
export async function fetchKitchens(): Promise<Kitchen[]> {
  const rows = await runQuery<unknown>((t) =>
    t.from('kitchen').select('id,code,name').eq('is_active', true).order('name'),
  );
  return rows.filter(isRecord).map((row) => ({
    id: str(row.id) ?? '',
    code: str(row.code) ?? '',
    name: str(row.name) ?? '',
  }));
}

export async function fetchCities(): Promise<City[]> {
  const rows = await runQuery<unknown>((t) =>
    t.from('city').select('id,code,name').eq('is_active', true).order('name'),
  );
  return rows.filter(isRecord).map((row) => ({
    id: str(row.id) ?? '',
    code: str(row.code) ?? '',
    name: str(row.name) ?? '',
  }));
}

// ---------------------------------------------------------------------------- writes

export interface SchoolConfigInput {
  /** ISO weekdays, 1 = Monday. `null` clears the override; omit to leave it alone. */
  serviceDays?: number[] | null;
  /** `HH:MM`. `null` clears the override. */
  orderCutoffTime?: string | null;
  orderCutoffDaysBefore?: number | null;
  maxAdvanceOrderDays?: number | null;
  minAdvanceOrderDays?: number | null;
}

export interface NewSchool {
  code: string;
  name: string;
  cityCode: string;
  kitchenCode: string;
  institutionType?: string;
  addressLine1?: string | null;
  addressLine2?: string | null;
  postcode?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  config?: SchoolConfigInput;
}

export interface CreatedSchool {
  id: string;
  code: string;
}

/**
 * Onboard a school.
 *
 * **`config` is optional and its keys mean three different things.** A key set to a value sets an
 * override; a key set to `null` clears one, so the setting inherits again; a key that is absent
 * leaves whatever is stored alone. Sending the whole object on every save — with `undefined`
 * collapsed to `null` by `JSON.stringify` — is how a partial form wipes settings it never showed,
 * which is why callers must build the object from what the operator actually touched.
 */
export async function createSchool(school: NewSchool): Promise<CreatedSchool> {
  return invokeFunction<CreatedSchool>('admin-school', school, 'POST');
}

export interface SchoolEdit {
  id: string;
  name?: string;
  institutionType?: string;
  addressLine1?: string | null;
  addressLine2?: string | null;
  postcode?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  config?: SchoolConfigInput;
}

export interface SchoolUpdateResult {
  id: string;
  /** What actually changed, as the server saw it. Config keys are prefixed `config.`. */
  changed: string[];
}

/**
 * Edit a school, or its configuration, or both.
 *
 * The `code` is deliberately not editable. It is the permanent key — `tools/bulk-import` matches
 * on it, and changing it would make the next import create a second school rather than update
 * this one. Renaming is what `name` is for.
 */
export async function updateSchool(edit: SchoolEdit): Promise<SchoolUpdateResult> {
  return invokeFunction<SchoolUpdateResult>('admin-school', edit, 'PATCH');
}
