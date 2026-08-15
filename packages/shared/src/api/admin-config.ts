/**
 * Per-school configuration, with where every value came from — `E10-06`.
 *
 * ## The whole point is the provenance, not the value
 *
 * `resolve_effective_config` already answers "what is this school's cutoff". It answers it as a
 * single scalar, and that is exactly what an operator must not be shown: `12:00 AM` tells you
 * nothing about whether somebody chose it for this school or whether it is the platform default
 * that every school gets. Those two facts lead to opposite actions — one you change here, the
 * other you change centrally or you will be changing it school by school forever.
 *
 * So this module does **not** call the resolver. It reads the three config rows separately and
 * resolves each setting in TypeScript, keeping the losing values rather than discarding them.
 * `SettingResolution` carries the effective value, the scope it came from, and what each level
 * holds — which is what lets the screen render "12:00 AM (platform default)" differently from
 * "11:00 AM — overridden for this school", and lets "Remove override" show what it would revert
 * to before it is clicked.
 *
 * ## Why the chain is duplicated here
 *
 * It is duplicated, and that is a real cost — `resolve_effective_config` and `resolveSetting`
 * below must agree or the screen lies about what the checkout will do. The alternative was worse:
 * a SQL function returning one row per setting with its scope, which is a second config API to
 * keep in step with the first, in a language with no test framework in this repo, for the benefit
 * of one screen.
 *
 * The duplication is contained to `coalesce(school, kitchen, platform)` — six words of logic,
 * asserted in both places. `admin-config.test.ts` covers the TypeScript half and
 * `supabase/tests/config_resolution.test.sql` the SQL half, and `SETTINGS` below names the scopes
 * each setting is allowed to be overridden at so a platform-only value cannot grow a school-level
 * override by accident.
 *
 * ## Reading these tables at all
 *
 * `0002` §9 gates all three on platform-scoped grants — `config.platform_edit`,
 * `kitchen.config_edit`, `school.config_edit` — and deliberately does not open them to kitchen
 * staff, because `revenue_share_bps` (`M4`) sits on the same row as the cutoff time and RLS
 * filters rows, never columns. A caller without the grants gets **empty arrays, not an error**,
 * which is why `fetchSchoolConfig` refuses rather than rendering a screen full of platform
 * defaults that would look like a school with no overrides.
 */
import { runQuery } from './client.js';

/** The three levels of the config chain (`D5`, §9.3). Ordered least to most specific. */
export type ConfigScope = 'platform' | 'kitchen' | 'school';

/** Where a setting may be overridden. Ordered least to most specific, and always includes `platform`. */
export type Overridable = readonly ConfigScope[];

export interface SettingSpec {
  /** The column name, identical on every table that carries it. */
  key: string;
  /** What the operator reads. */
  label: string;
  /** One line under the label. Empty for settings whose name is self-explanatory. */
  help: string;
  /**
   * The scopes this setting exists at.
   *
   * Statutory and platform-wide values are `['platform']`: the GST rates are set by law, not by
   * a school, and `timezone` has no `school_config` column at all. A screen that offered an
   * override here would be offering to write a column that does not exist.
   */
  scopes: Overridable;
  kind: 'time' | 'integer' | 'boolean' | 'weekdays' | 'text' | 'enum';
}

/**
 * Every setting the config screen shows, in the order it shows them.
 *
 * **Not every column on the config tables.** The tax rates, `sac_code` and
 * `price_is_tax_inclusive` are read-only facts of the platform and belong on an invoicing
 * screen; the payment timing settings (`0037`) belong to the payments thread. What is here is
 * what `E10-06` names — cutoff, service days, the advance window, revenue share and the
 * cancellation rules — which is also the set an operator changes when onboarding a school.
 */
export const SETTINGS: readonly SettingSpec[] = [
  {
    key: 'order_cutoff_time',
    label: 'Order cutoff',
    help: 'The time of day ordering closes. With 0 days before, 12:00 AM means midnight at the start of the service day.',
    scopes: ['platform', 'kitchen', 'school'],
    kind: 'time',
  },
  {
    key: 'order_cutoff_days_before',
    label: 'Cutoff days before',
    help: 'How many days ahead of the service date the cutoff falls. 0 is the same day.',
    scopes: ['platform', 'kitchen', 'school'],
    kind: 'integer',
  },
  {
    key: 'service_days',
    label: 'Service days',
    help: 'The weekdays this school is served. A day outside this set is never offered.',
    scopes: ['platform', 'kitchen', 'school'],
    kind: 'weekdays',
  },
  {
    key: 'max_advance_order_days',
    label: 'Order up to',
    help: 'How far ahead a parent may order, in days.',
    scopes: ['platform', 'kitchen', 'school'],
    kind: 'integer',
  },
  {
    key: 'min_advance_order_days',
    label: 'Order no sooner than',
    help: 'Lead time in days. 0 lets a parent order for today, subject to the cutoff.',
    scopes: ['platform', 'kitchen', 'school'],
    kind: 'integer',
  },
  {
    key: 'revenue_share_bps',
    label: 'Revenue share',
    help: 'The school’s share, in basis points. 1000 is 10%.',
    scopes: ['platform', 'kitchen', 'school'],
    kind: 'integer',
  },
  {
    key: 'customer_cancellation_allowed',
    label: 'Parents may cancel',
    help: '',
    scopes: ['platform', 'kitchen', 'school'],
    kind: 'boolean',
  },
  {
    key: 'customer_cancellation_cutoff_minutes',
    label: 'Cancellation closes',
    help: 'Minutes before the order cutoff. 0 lets a parent cancel right up to it.',
    scopes: ['platform', 'kitchen', 'school'],
    kind: 'integer',
  },
  {
    key: 'timezone',
    label: 'Timezone',
    help: 'Set per kitchen. Every cutoff on this page is computed in it.',
    scopes: ['platform', 'kitchen'],
    kind: 'text',
  },
];

/** One setting, resolved, with everything the screen needs to explain the answer. */
export interface SettingResolution {
  spec: SettingSpec;
  /** The value that applies. Never null once resolved — the platform row is NOT NULL throughout. */
  value: unknown;
  /** Which level supplied `value`. */
  source: ConfigScope;
  /** What each level holds. `null` at kitchen or school means "not overridden here". */
  atScope: Record<ConfigScope, unknown>;
  /**
   * True when `source` is not `platform`.
   *
   * The screen's single most important boolean: an overridden setting is drawn differently from
   * an inherited one, and `E10-06` is that requirement and very little else.
   */
  isOverridden: boolean;
  /**
   * What this setting would fall back to if the school-level override were removed.
   *
   * Computed here rather than in the screen because "Remove override" must be able to say what
   * it will do *before* it is clicked. An operator clearing a school cutoff at a school whose
   * kitchen also overrides it does not revert to the platform default, and a confirmation that
   * claims otherwise is worse than no confirmation.
   */
  revertsTo: { value: unknown; source: ConfigScope } | null;
}

/** The three raw rows, exactly as the tables hold them. */
export interface ConfigRows {
  platform: Record<string, unknown>;
  kitchen: Record<string, unknown> | null;
  school: Record<string, unknown> | null;
}

export class AdminConfigError extends Error {
  constructor(detail: string) {
    super(`The configuration is not readable: ${detail}`);
    this.name = 'AdminConfigError';
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Whether a level has an opinion on a setting.
 *
 * **`null` and `undefined` are both "no opinion", and `false` and `0` are opinions.** That
 * distinction is the entire inheritance model and it is the easiest thing in this file to get
 * wrong: a falsy check here would make `customer_cancellation_allowed: false` — a school that has
 * deliberately turned cancellation off — read as "not overridden", and the screen would show
 * cancellation as allowed while the database refused every cancellation. `undefined` is included
 * because a column absent from the selected list arrives that way rather than as null.
 */
const hasValue = (row: Record<string, unknown> | null, key: string): boolean =>
  row !== null && row[key] !== null && row[key] !== undefined;

/**
 * Resolve one setting across the three rows, keeping the losers.
 *
 * The `scopes` list is consulted rather than assumed: a setting that only exists at platform
 * level must not pick up a value from a `kitchen_config` column of the same name, and `timezone`
 * is exactly that case — it is on `kitchen_config` but not on `school_config`.
 */
export function resolveSetting(spec: SettingSpec, rows: ConfigRows): SettingResolution {
  const atScope: Record<ConfigScope, unknown> = {
    platform: rows.platform[spec.key] ?? null,
    kitchen: spec.scopes.includes('kitchen') && hasValue(rows.kitchen, spec.key)
      ? rows.kitchen![spec.key]
      : null,
    school: spec.scopes.includes('school') && hasValue(rows.school, spec.key)
      ? rows.school![spec.key]
      : null,
  };

  // Most specific wins, and the order of this list is the config chain.
  const order: ConfigScope[] = ['school', 'kitchen', 'platform'];
  const winner = order.find((scope) =>
    scope === 'platform' ? atScope.platform !== null : atScope[scope] !== null,
  );

  if (winner === undefined) {
    // The platform row is NOT NULL on every column in SETTINGS, so this means the row is
    // missing or the column was not selected — a wiring fault, not a configuration state.
    throw new AdminConfigError(`no platform value for ${spec.key}`);
  }

  // What removing the SCHOOL override would leave. Deliberately skips the school level rather
  // than "the next one down from the winner": when the winner is already the kitchen there is no
  // school override to remove, and the answer is null rather than the platform default.
  const fallback = order
    .filter((scope) => scope !== 'school')
    .find((scope) => (scope === 'platform' ? true : atScope[scope] !== null));

  return {
    spec,
    value: atScope[winner],
    source: winner,
    atScope,
    isOverridden: winner !== 'platform',
    revertsTo:
      atScope.school !== null && fallback !== undefined
        ? { value: atScope[fallback], source: fallback }
        : null,
  };
}

/** Every setting on the screen, resolved. */
export function resolveAll(rows: ConfigRows): SettingResolution[] {
  return SETTINGS.map((spec) => resolveSetting(spec, rows));
}

/**
 * The columns read from each table.
 *
 * Spelled out for the same reason `SCHOOL_COLUMNS` is: a policy filters rows, never columns.
 * `select('*')` on `platform_config` would also hand over the payment-timing settings and
 * `price_is_tax_inclusive`, none of which this screen shows — and on `school_config` it is
 * `revenue_share_bps` that `M4` calls commercially sensitive. Everything here is deliberate and
 * `admin-config.test.ts` asserts the lists.
 */
const columnsFor = (scope: ConfigScope): string => {
  const keys = SETTINGS.filter((s) => s.scopes.includes(scope)).map((s) => s.key);
  const identity = scope === 'platform' ? 'id' : scope === 'kitchen' ? 'kitchen_id' : 'school_id';
  return [identity, ...keys, 'updated_at'].join(',');
};

export const PLATFORM_CONFIG_COLUMNS = columnsFor('platform');
export const KITCHEN_CONFIG_COLUMNS = columnsFor('kitchen');
export const SCHOOL_CONFIG_COLUMNS = columnsFor('school');

export interface SchoolConfigView {
  schoolId: string;
  kitchenId: string;
  settings: SettingResolution[];
  rows: ConfigRows;
}

/**
 * Read a school's configuration, with provenance.
 *
 * Four reads rather than one join: PostgREST cannot embed `platform_config` (no foreign key to
 * it) and the three tables are gated by three different grants, so a partial read is a real
 * outcome that has to be distinguishable from "nothing is overridden".
 *
 * **An empty `platform_config` is refused, not defaulted.** `0002` gives a caller without
 * `config.platform_edit` an empty result rather than an error, so a missing platform row and a
 * missing grant look identical from here — and the failure mode of guessing is a screen that
 * shows every setting as an inherited default when the truth is that this operator cannot see
 * the configuration at all. That is `[AUTH-01]`: a permissions failure must never render as a
 * clean, ordinary state.
 */
export async function fetchSchoolConfig(schoolId: string): Promise<SchoolConfigView> {
  const schools = await runQuery<unknown>((t) =>
    t.from('school').select('id,kitchen_id').eq('id', schoolId),
  );
  const school = schools[0];
  if (!isRecord(school) || typeof school.kitchen_id !== 'string') {
    throw new AdminConfigError(`school ${schoolId} was not found, or its kitchen is not readable`);
  }
  const kitchenId = school.kitchen_id;

  const [platformRows, kitchenRows, schoolRows] = await Promise.all([
    runQuery<unknown>((t) => t.from('platform_config').select(PLATFORM_CONFIG_COLUMNS).eq('id', 1)),
    runQuery<unknown>((t) =>
      t.from('kitchen_config').select(KITCHEN_CONFIG_COLUMNS).eq('kitchen_id', kitchenId),
    ),
    runQuery<unknown>((t) =>
      t.from('school_config').select(SCHOOL_CONFIG_COLUMNS).eq('school_id', schoolId),
    ),
  ]);

  const platform = platformRows[0];
  if (!isRecord(platform)) {
    throw new AdminConfigError(
      'the platform defaults came back empty. That is what a missing `config.platform_edit` ' +
        'grant looks like from here, and it is not the same as a school with no overrides.',
    );
  }

  // A missing kitchen or school row is ordinary and means "nothing overridden at this level".
  // Unlike the platform row, absence here is a real and common configuration state.
  const rows: ConfigRows = {
    platform,
    kitchen: isRecord(kitchenRows[0]) ? kitchenRows[0] : null,
    school: isRecord(schoolRows[0]) ? schoolRows[0] : null,
  };

  return { schoolId, kitchenId, settings: resolveAll(rows), rows };
}

// ---------------------------------------------------------------------------- formatting

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Render a value the way the operator set it.
 *
 * Lives here rather than in the Astro page so that the unit tests can assert it — a cutoff
 * rendered in the wrong half of the day is the exact class of bug `E09-32` already cost this
 * project a morning over, and `12:00 AM` versus `12:00 PM` is a whole day of orders.
 */
export function formatSettingValue(spec: SettingSpec, value: unknown): string {
  if (value === null || value === undefined) return 'not set';

  switch (spec.kind) {
    case 'time': {
      // Postgres renders `time` as `HH:MM:SS`. Formatted by hand rather than through `Date`,
      // because building a Date to format a wall-clock time drags a timezone into a value that
      // has none — which is how a 00:00 cutoff becomes 05:30 or yesterday. See docs/learnings.md.
      const [hRaw = '', m = '00'] = String(value).split(':');
      const h = Number(hRaw);
      if (!Number.isInteger(h) || h < 0 || h > 23) return String(value);
      const suffix = h < 12 ? 'AM' : 'PM';
      const hour12 = h % 12 === 0 ? 12 : h % 12;
      return `${hour12}:${m} ${suffix}`;
    }
    case 'weekdays': {
      if (!Array.isArray(value)) return String(value);
      const days = value
        .map((d) => Number(d))
        .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7)
        .sort((a, b) => a - b);
      if (days.length === 7) return 'Every day';
      if (days.length === 0) return 'none';
      // Named rather than abbreviated to a range: "Mon–Fri" is a lie about {1,2,3,5} and the
      // reader has no way to tell. Seven short words is not worth a wrong answer.
      return days.map((d) => WEEKDAYS[d - 1]).join(', ');
    }
    case 'boolean':
      return value === true ? 'Yes' : 'No';
    case 'integer': {
      if (spec.key === 'revenue_share_bps' && typeof value === 'number') {
        // Basis points are stored as integers so the arithmetic stays exact (non-negotiable #3).
        // Displayed as a percentage because that is the unit the conversation with a school
        // happens in — and with at most two decimals, because 1000 bps is 10%, not 10.00%.
        return `${String(Number((value / 100).toFixed(2)))}%`;
      }
      return String(value);
    }
    default:
      return String(value);
  }
}

/** How the screen labels where a value came from. */
export function sourceLabel(resolution: SettingResolution): string {
  switch (resolution.source) {
    case 'school':
      return 'overridden for this school';
    case 'kitchen':
      return 'inherited from the kitchen';
    case 'platform':
      return 'platform default';
  }
}
