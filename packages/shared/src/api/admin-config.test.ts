import { describe, expect, it } from 'vitest';

import {
  AdminConfigError,
  KITCHEN_CONFIG_COLUMNS,
  PLATFORM_CONFIG_COLUMNS,
  SCHOOL_CONFIG_COLUMNS,
  SETTINGS,
  formatSettingValue,
  resolveAll,
  resolveSetting,
  sourceLabel,
  type ConfigRows,
  type SettingSpec,
} from './admin-config.js';

const spec = (key: string, over: Partial<SettingSpec> = {}): SettingSpec => ({
  key,
  label: key,
  help: '',
  scopes: ['platform', 'kitchen', 'school'],
  kind: 'integer',
  ...over,
});

const rows = (
  platform: Record<string, unknown>,
  kitchen: Record<string, unknown> | null = null,
  school: Record<string, unknown> | null = null,
): ConfigRows => ({ platform, kitchen, school });

describe('resolveSetting — the chain', () => {
  it('falls back to the platform value when nothing is overridden', () => {
    const r = resolveSetting(spec('max_advance_order_days'), rows({ max_advance_order_days: 14 }));
    expect(r.value).toBe(14);
    expect(r.source).toBe('platform');
    expect(r.isOverridden).toBe(false);
  });

  it('prefers the kitchen value over the platform value', () => {
    const r = resolveSetting(
      spec('max_advance_order_days'),
      rows({ max_advance_order_days: 14 }, { max_advance_order_days: 7 }),
    );
    expect(r.value).toBe(7);
    expect(r.source).toBe('kitchen');
    expect(r.isOverridden).toBe(true);
  });

  it('prefers the school value over both', () => {
    const r = resolveSetting(
      spec('max_advance_order_days'),
      rows({ max_advance_order_days: 14 }, { max_advance_order_days: 7 }, { max_advance_order_days: 3 }),
    );
    expect(r.value).toBe(3);
    expect(r.source).toBe('school');
  });

  it('keeps the losing values so the screen can explain the answer', () => {
    const r = resolveSetting(
      spec('max_advance_order_days'),
      rows({ max_advance_order_days: 14 }, { max_advance_order_days: 7 }, { max_advance_order_days: 3 }),
    );
    expect(r.atScope).toEqual({ platform: 14, kitchen: 7, school: 3 });
  });

  it('reports a level with no row as not overridden rather than as a null value', () => {
    const r = resolveSetting(spec('max_advance_order_days'), rows({ max_advance_order_days: 14 }));
    expect(r.atScope.kitchen).toBeNull();
    expect(r.atScope.school).toBeNull();
  });

  it('throws when the platform value is missing, rather than resolving to null', () => {
    // A missing platform row is what an absent `config.platform_edit` grant looks like through
    // PostgREST — an empty result, not an error. Resolving it to null would render the screen
    // as "nothing configured", which is [AUTH-01]: a permissions failure must not look ordinary.
    expect(() => resolveSetting(spec('max_advance_order_days'), rows({}))).toThrow(AdminConfigError);
  });
});

describe('resolveSetting — false and zero are opinions', () => {
  // The single easiest thing in the module to get wrong. A falsy check would treat a deliberate
  // `false` as "not overridden", and the screen would show cancellation as allowed at a school
  // that has turned it off.
  it('treats a school-level false as an override, not as absence', () => {
    const r = resolveSetting(
      spec('customer_cancellation_allowed', { kind: 'boolean' }),
      rows({ customer_cancellation_allowed: true }, null, { customer_cancellation_allowed: false }),
    );
    expect(r.value).toBe(false);
    expect(r.source).toBe('school');
    expect(r.isOverridden).toBe(true);
  });

  it('treats a school-level 0 as an override, not as absence', () => {
    const r = resolveSetting(
      spec('customer_cancellation_cutoff_minutes'),
      rows({ customer_cancellation_cutoff_minutes: 60 }, null, {
        customer_cancellation_cutoff_minutes: 0,
      }),
    );
    expect(r.value).toBe(0);
    expect(r.source).toBe('school');
  });

  it('treats an explicit null as inherit', () => {
    const r = resolveSetting(
      spec('customer_cancellation_cutoff_minutes'),
      rows({ customer_cancellation_cutoff_minutes: 60 }, null, {
        customer_cancellation_cutoff_minutes: null,
      }),
    );
    expect(r.value).toBe(60);
    expect(r.source).toBe('platform');
  });

  it('treats a row that exists but omits the column as inherit', () => {
    // A school_config row created to set the cutoff leaves every other column null. If that read
    // as "overridden to null" the school would silently lose every other setting.
    const r = resolveSetting(
      spec('max_advance_order_days'),
      rows({ max_advance_order_days: 14 }, null, { order_cutoff_time: '11:00:00' }),
    );
    expect(r.value).toBe(14);
    expect(r.source).toBe('platform');
  });
});

describe('resolveSetting — scopes are respected', () => {
  it('ignores a kitchen value for a platform-only setting', () => {
    const r = resolveSetting(
      spec('cgst_rate_bps', { scopes: ['platform'] }),
      rows({ cgst_rate_bps: 250 }, { cgst_rate_bps: 900 }),
    );
    expect(r.value).toBe(250);
    expect(r.source).toBe('platform');
    expect(r.atScope.kitchen).toBeNull();
  });

  it('ignores a school value for a setting with no school column', () => {
    // `timezone` is on kitchen_config and NOT on school_config. Offering an override would be
    // offering to write a column that does not exist.
    const r = resolveSetting(
      spec('timezone', { scopes: ['platform', 'kitchen'], kind: 'text' }),
      rows({ timezone: 'Asia/Kolkata' }, null, { timezone: 'Europe/London' }),
    );
    expect(r.value).toBe('Asia/Kolkata');
    expect(r.source).toBe('platform');
  });
});

describe('revertsTo — what "remove override" would do', () => {
  it('is null when there is no school override to remove', () => {
    const r = resolveSetting(spec('max_advance_order_days'), rows({ max_advance_order_days: 14 }));
    expect(r.revertsTo).toBeNull();
  });

  it('reverts to the platform value when only the school overrides', () => {
    const r = resolveSetting(
      spec('max_advance_order_days'),
      rows({ max_advance_order_days: 14 }, null, { max_advance_order_days: 3 }),
    );
    expect(r.revertsTo).toEqual({ value: 14, source: 'platform' });
  });

  it('reverts to the KITCHEN value when the kitchen also overrides', () => {
    // The assertion behind the confirmation text. Clearing a school override at a school whose
    // kitchen overrides the same setting does not go back to the platform default, and a dialog
    // that claims it does is worse than no dialog.
    const r = resolveSetting(
      spec('max_advance_order_days'),
      rows({ max_advance_order_days: 14 }, { max_advance_order_days: 7 }, { max_advance_order_days: 3 }),
    );
    expect(r.revertsTo).toEqual({ value: 7, source: 'kitchen' });
  });

  it('is null when the kitchen overrides but the school does not', () => {
    const r = resolveSetting(
      spec('max_advance_order_days'),
      rows({ max_advance_order_days: 14 }, { max_advance_order_days: 7 }),
    );
    expect(r.source).toBe('kitchen');
    expect(r.revertsTo).toBeNull();
  });
});

describe('the column lists', () => {
  // Spelled out for the same reason SCHOOL_COLUMNS is: a policy filters rows, never columns.
  it('never selects * from any config table', () => {
    for (const list of [PLATFORM_CONFIG_COLUMNS, KITCHEN_CONFIG_COLUMNS, SCHOOL_CONFIG_COLUMNS]) {
      expect(list).not.toContain('*');
    }
  });

  it('does not read the payment timing settings, which belong to another surface', () => {
    for (const list of [PLATFORM_CONFIG_COLUMNS, KITCHEN_CONFIG_COLUMNS, SCHOOL_CONFIG_COLUMNS]) {
      expect(list).not.toContain('pending_payment_ttl_minutes');
      expect(list).not.toContain('payment_retry_window_minutes');
    }
  });

  it('does not offer timezone as a school column, because there is not one', () => {
    expect(SCHOOL_CONFIG_COLUMNS).not.toContain('timezone');
    expect(KITCHEN_CONFIG_COLUMNS).toContain('timezone');
  });

  it('keys each list to its own identity column', () => {
    expect(PLATFORM_CONFIG_COLUMNS.startsWith('id,')).toBe(true);
    expect(KITCHEN_CONFIG_COLUMNS.startsWith('kitchen_id,')).toBe(true);
    expect(SCHOOL_CONFIG_COLUMNS.startsWith('school_id,')).toBe(true);
  });
});

describe('formatSettingValue', () => {
  const time = spec('order_cutoff_time', { kind: 'time' });

  it('renders midnight as 12:00 AM, not 0:00 or 12:00 PM', () => {
    // A cutoff in the wrong half of the day is a whole day of orders. E09-32 cost a morning to
    // the same class of bug.
    expect(formatSettingValue(time, '00:00:00')).toBe('12:00 AM');
  });

  it('renders noon as 12:00 PM', () => {
    expect(formatSettingValue(time, '12:00:00')).toBe('12:00 PM');
  });

  it('renders an afternoon time in 12-hour form', () => {
    expect(formatSettingValue(time, '15:30:00')).toBe('3:30 PM');
  });

  it('passes an unparseable time through rather than inventing one', () => {
    expect(formatSettingValue(time, 'not a time')).toBe('not a time');
  });

  const weekdays = spec('service_days', { kind: 'weekdays' });

  it('calls all seven days "Every day"', () => {
    expect(formatSettingValue(weekdays, [1, 2, 3, 4, 5, 6, 7])).toBe('Every day');
  });

  it('names the days rather than collapsing them to a range', () => {
    // "Mon–Fri" is a lie about {1,2,3,5} and the reader cannot tell.
    expect(formatSettingValue(weekdays, [1, 2, 3, 5])).toBe('Mon, Tue, Wed, Fri');
  });

  it('sorts the days regardless of the order they are stored in', () => {
    expect(formatSettingValue(weekdays, [5, 1, 3])).toBe('Mon, Wed, Fri');
  });

  it('renders basis points as the percentage the school conversation happens in', () => {
    expect(formatSettingValue(spec('revenue_share_bps'), 1000)).toBe('10%');
    expect(formatSettingValue(spec('revenue_share_bps'), 1250)).toBe('12.5%');
  });

  it('renders a boolean as Yes or No', () => {
    const b = spec('customer_cancellation_allowed', { kind: 'boolean' });
    expect(formatSettingValue(b, true)).toBe('Yes');
    expect(formatSettingValue(b, false)).toBe('No');
  });

  it('says "not set" for a null rather than rendering an empty cell', () => {
    expect(formatSettingValue(time, null)).toBe('not set');
  });
});

describe('sourceLabel', () => {
  it('distinguishes all three sources in words, not only in styling', () => {
    // E10-06's requirement is that an override is *visibly* distinct. Colour alone fails
    // check:a11y and fails anyone reading this on a kitchen tablet in daylight.
    const base = rows({ max_advance_order_days: 14 }, { max_advance_order_days: 7 }, { max_advance_order_days: 3 });
    expect(sourceLabel(resolveSetting(spec('max_advance_order_days'), base))).toBe(
      'overridden for this school',
    );
    expect(
      sourceLabel(
        resolveSetting(spec('max_advance_order_days'), rows({ max_advance_order_days: 14 }, { max_advance_order_days: 7 })),
      ),
    ).toBe('inherited from the kitchen');
    expect(
      sourceLabel(resolveSetting(spec('max_advance_order_days'), rows({ max_advance_order_days: 14 }))),
    ).toBe('platform default');
  });
});

describe('resolveAll', () => {
  it('resolves every setting on the screen from one set of rows', () => {
    const platform: Record<string, unknown> = {};
    for (const s of SETTINGS) platform[s.key] = s.kind === 'weekdays' ? [1, 2, 3, 4, 5, 6, 7] : 1;
    const all = resolveAll(rows(platform));
    expect(all).toHaveLength(SETTINGS.length);
    expect(all.every((r) => r.source === 'platform')).toBe(true);
  });

  it('covers the settings E10-06 names', () => {
    const keys = SETTINGS.map((s) => s.key);
    expect(keys).toContain('order_cutoff_time');
    expect(keys).toContain('service_days');
    expect(keys).toContain('revenue_share_bps');
  });
});
