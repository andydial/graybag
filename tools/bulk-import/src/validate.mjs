// Turning parsed rows into rows we would be willing to write, or into errors naming the row.
//
// ## Every failure names the row and the column
//
// This runs on 17 August against files exported from Bubble, by one person, two days before
// go-live. "3 rows are invalid" costs an hour of bisecting a spreadsheet; "row 12: `price` is
// `₹45.00`, which is not a whole number of paise — write 4500" costs ten seconds. Every message
// below is written to be the second kind, and `test/validate.test.mjs` asserts the wording of the
// ones most likely to be hit.
//
// ## Nothing here is coerced silently
//
// A price of `45.5` paise is refused rather than rounded, an unknown food type is refused rather
// than left null, and a blank required field is refused rather than defaulted. Non-negotiable #3
// is about the type as much as the arithmetic, and every silent coercion on an import day becomes
// a wrong menu that nobody can trace back to the file.

/** ISO weekday numbers, 1 = Monday, matching `menu_item.available_days` and `service_days`. */
const WEEKDAY_ALIASES = {
  mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
  sun: 7, sunday: 7,
};

const FOOD_TYPES = ['veg', 'non_veg', 'egg'];
const INSTITUTION_TYPES = ['school', 'college'];

/** A single problem with a single row. `column` is null when the row as a whole is wrong. */
const problem = (row, column, message) => ({ row: row.__row, column, message });

const required = (row, column, errors) => {
  const v = row[column];
  if (v === undefined || v === '') {
    errors.push(problem(row, column, `${column} is required and is blank`));
    return null;
  }
  return v;
};

/**
 * Integer paise, refusing everything that looks like money but is not.
 *
 * `₹45.00`, `45.00` and `4,500` are all things a spreadsheet produces and all of them are
 * ambiguous about the unit. Refusing them with the correction spelled out is the only version
 * of this that cannot put a price out by a factor of a hundred.
 */
const paise = (row, column, errors, { optional = false } = {}) => {
  const raw = row[column];
  if (raw === undefined || raw === '') {
    if (!optional) errors.push(problem(row, column, `${column} is required and is blank`));
    return null;
  }
  if (/[₹,]/.test(raw)) {
    errors.push(problem(row, column,
      `${column} is "${raw}". Write integer paise with no symbol and no separators — ₹45.00 is 4500`));
    return null;
  }
  if (!/^\d+$/.test(raw)) {
    errors.push(problem(row, column,
      `${column} is "${raw}", which is not a whole number of paise. ₹45.00 is 4500, not 45 and not 45.00`));
    return null;
  }
  return Number(raw);
};

const integer = (row, column, errors, { optional = false, min, max } = {}) => {
  const raw = row[column];
  if (raw === undefined || raw === '') {
    if (!optional) errors.push(problem(row, column, `${column} is required and is blank`));
    return null;
  }
  if (!/^-?\d+$/.test(raw)) {
    errors.push(problem(row, column, `${column} is "${raw}", which is not a whole number`));
    return null;
  }
  const n = Number(raw);
  if (min !== undefined && n < min) {
    errors.push(problem(row, column, `${column} is ${n}, below the minimum of ${min}`));
    return null;
  }
  if (max !== undefined && n > max) {
    errors.push(problem(row, column, `${column} is ${n}, above the maximum of ${max}`));
    return null;
  }
  return n;
};

const oneOf = (row, column, errors, allowed, { optional = false } = {}) => {
  const raw = (row[column] ?? '').toLowerCase().replace(/[\s-]+/g, '_');
  if (raw === '') {
    if (!optional) errors.push(problem(row, column, `${column} is required and is blank`));
    return null;
  }
  if (!allowed.includes(raw)) {
    errors.push(problem(row, column,
      `${column} is "${row[column]}". It must be one of: ${allowed.join(', ')}`));
    return null;
  }
  return raw;
};

/**
 * A weekday set, from either numbers or names.
 *
 * `1,2,3,4,5` and `Mon,Tue,Wed,Thu,Fri` both work, because both are what somebody types. The
 * output is always ISO numbers, so the two spellings cannot mean different things downstream.
 */
export const parseWeekdays = (row, column, errors, { optional = false } = {}) => {
  const raw = row[column];
  if (raw === undefined || raw === '') {
    if (!optional) errors.push(problem(row, column, `${column} is required and is blank`));
    return null;
  }
  const parts = String(raw).split(/[;,|]/).map((p) => p.trim()).filter((p) => p !== '');
  const days = [];
  for (const part of parts) {
    const named = WEEKDAY_ALIASES[part.toLowerCase()];
    if (named !== undefined) {
      days.push(named);
      continue;
    }
    if (/^[1-7]$/.test(part)) {
      days.push(Number(part));
      continue;
    }
    // 0 is deliberately called out: it is a valid weekday in the other common encoding, and
    // somebody converting a file by hand will reach for it for Sunday.
    errors.push(problem(row, column,
      part === '0'
        ? `${column} contains 0. This system numbers weekdays 1-7 with Monday as 1, so Sunday is 7`
        : `${column} contains "${part}", which is not a weekday. Use 1-7 (Monday is 1) or names like Mon`));
    return null;
  }
  const unique = [...new Set(days)].sort((a, b) => a - b);
  if (unique.length === 0) {
    errors.push(problem(row, column, `${column} is empty. A school served on no days is closed — leave it blank to inherit, or deactivate the school`));
    return null;
  }
  return unique;
};

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/;

const time = (row, column, errors, { optional = false } = {}) => {
  const raw = row[column];
  if (raw === undefined || raw === '') {
    if (!optional) errors.push(problem(row, column, `${column} is required and is blank`));
    return null;
  }
  const m = HHMM.exec(raw.trim());
  if (!m) {
    errors.push(problem(row, column,
      `${column} is "${raw}". Use 24-hour HH:MM — 1:30 PM is 13:30, and midnight is 00:00`));
    return null;
  }
  return `${m[1].padStart(2, '0')}:${m[2]}:00`;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const date = (row, column, errors, { optional = false } = {}) => {
  const raw = row[column];
  if (raw === undefined || raw === '') {
    if (!optional) errors.push(problem(row, column, `${column} is required and is blank`));
    return null;
  }
  if (!DATE.test(raw.trim())) {
    errors.push(problem(row, column,
      `${column} is "${raw}". Use YYYY-MM-DD — 17/08/2026 is ambiguous and 2026-08-17 is not`));
    return null;
  }
  const [y, m, d] = raw.trim().split('-').map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    errors.push(problem(row, column, `${column} is "${raw}", which is not a real date`));
    return null;
  }
  return raw.trim();
};

const CODE = /^[a-z0-9][a-z0-9_-]*$/;

/**
 * A stable identifier for a school or a menu.
 *
 * Constrained rather than free text because it is the **match key** — re-running the import finds
 * an existing school by its code. A code that differs only by case or a trailing space between
 * two runs creates a duplicate school, and a duplicate school on 19 August is orders arriving
 * against a record nobody is looking at.
 */
const code = (row, column, errors) => {
  const raw = required(row, column, errors);
  if (raw === null) return null;
  const lower = raw.toLowerCase();
  if (!CODE.test(lower)) {
    errors.push(problem(row, column,
      `${column} is "${raw}". Use lower-case letters, digits, hyphens and underscores only — ` +
      `it is the key that matches this row to an existing record on a re-run`));
    return null;
  }
  return lower;
};

const email = (row, column, errors, { optional = true } = {}) => {
  const raw = row[column];
  if (raw === undefined || raw === '') {
    if (!optional) errors.push(problem(row, column, `${column} is required and is blank`));
    return null;
  }
  // Deliberately loose. An address is validated by sending to it; a strict pattern here would
  // reject something deliverable and block an import for no gain.
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(raw)) {
    errors.push(problem(row, column, `${column} is "${raw}", which is not an email address`));
    return null;
  }
  return raw.toLowerCase();
};

// ---------------------------------------------------------------------------- schools

export function validateSchools(rows) {
  const errors = [];
  const records = [];
  const codes = new Map();

  for (const row of rows) {
    const before = errors.length;

    const schoolCode = code(row, 'code', errors);
    const name = required(row, 'name', errors);
    // `city_code` is the documented name; `city` is accepted because it is what somebody
    // writes without reading the document, and refusing it teaches nothing.
    const cityColumn = row.city_code !== undefined && row.city_code !== '' ? 'city_code' : 'city';
    const city = required(row, cityColumn, errors);
    const kitchen = required(row, 'kitchen_code', errors);

    const record = {
      __row: row.__row,
      code: schoolCode,
      name,
      city: city ? city.toLowerCase() : null,
      kitchenCode: kitchen ? kitchen.toLowerCase() : null,
      institutionType: oneOf(row, 'institution_type', errors, INSTITUTION_TYPES, { optional: true }) ?? 'school',
      addressLine1: row.address_line1 || null,
      addressLine2: row.address_line2 || null,
      postcode: row.postcode || null,
      contactName: row.contact_name || null,
      contactEmail: email(row, 'contact_email', errors),
      contactPhone: row.contact_phone || null,
      serviceDays: parseWeekdays(row, 'service_days', errors, { optional: true }),
      cutoffTime: time(row, 'order_cutoff_time', errors, { optional: true }),
      cutoffDaysBefore: integer(row, 'order_cutoff_days_before', errors, { optional: true, min: 0, max: 30 }),
    };

    // A duplicate code within one file is caught here rather than by the database, because the
    // database would accept the first and reject the second with a constraint name, halfway
    // through a write.
    if (schoolCode !== null) {
      if (codes.has(schoolCode)) {
        errors.push(problem(row, 'code',
          `code "${schoolCode}" is also used on row ${codes.get(schoolCode)}. Codes must be unique within the file`));
      } else {
        codes.set(schoolCode, row.__row);
      }
    }

    if (errors.length === before) records.push(record);
  }

  return { records, errors };
}

// ---------------------------------------------------------------------------- dishes

export function validateDishes(rows) {
  const errors = [];
  const records = [];
  const names = new Map();

  for (const row of rows) {
    const before = errors.length;

    const name = required(row, 'name', errors);
    const kitchen = required(row, 'kitchen_code', errors);

    const record = {
      __row: row.__row,
      name,
      kitchenCode: kitchen ? kitchen.toLowerCase() : null,
      // The category CODE (`quick_bites`), not its display name.
      category: (required(row, 'category', errors) ?? '').toLowerCase() || null,
      // `food_type` is [DM-17] OPEN and nullable in the schema — the source Excel has no such
      // column. Optional here for the same reason: refusing a dish for want of it would block
      // the import over a field the data does not have.
      foodType: oneOf(row, 'food_type', errors, FOOD_TYPES, { optional: true }),
      description: row.description || null,
      ingredientsText: row.ingredients || null,
      caloriesKcal: integer(row, 'calories_kcal', errors, { optional: true, min: 0, max: 10000 }),
      portionText: row.portion || null,
      // Allergen CODES, not names — `recipient_allergen` and `dish_allergen` share one
      // vocabulary, and that shared id is the whole mechanism behind an allergen warning.
      allergens: (row.allergens || '')
        .split(/[;,|]/)
        .map((a) => a.trim().toLowerCase().replace(/[\s-]+/g, '_'))
        .filter((a) => a !== ''),
      imageFile: row.image_file || null,
      // **Absent means "no opinion", not "true".**
      //
      // Defaulting a missing `is_active` column to `true` would make every import of a partial
      // file **re-activate every dish that had been retired** — silently, and across the whole
      // catalogue, because the planner would see a change on every row. A file that does not
      // mention activation must not decide it. `null` here, and `changedFields` skips nulls.
      //
      // A dish being *created* still defaults to active; that decision lives in `db.mjs`, where
      // it is about a new row rather than about an existing one.
      isActive: row.is_active === undefined || row.is_active === ''
        ? null
        : row.is_active.toLowerCase() !== 'false',
    };

    // The database has `unique (kitchen_id, lower(name))`, so this mirrors the real key.
    if (name !== null && record.kitchenCode !== null) {
      const key = `${record.kitchenCode}::${name.toLowerCase()}`;
      if (names.has(key)) {
        errors.push(problem(row, 'name',
          `"${name}" already appears on row ${names.get(key)} for the same kitchen. ` +
          `A dish is unique per kitchen by name`));
      } else {
        names.set(key, row.__row);
      }
    }

    if (errors.length === before) records.push(record);
  }

  return { records, errors };
}

// ---------------------------------------------------------------------------- menu

/**
 * One row per dish on a menu, plus where and when that menu applies.
 *
 * Flat rather than nested because it comes out of a spreadsheet. The menu itself and its
 * assignment are derived from the repeated columns, which is why `plan.mjs` groups by menu_code
 * rather than expecting a separate file.
 */
export function validateMenuItems(rows) {
  const errors = [];
  const records = [];
  const seen = new Map();

  for (const row of rows) {
    const before = errors.length;

    const menuCode = code(row, 'menu_code', errors);
    const dishName = required(row, 'dish_name', errors);
    const kitchen = required(row, 'kitchen_code', errors);

    const validFrom = date(row, 'valid_from', errors, { optional: true });
    const validTo = date(row, 'valid_to', errors, { optional: true });
    if (validFrom !== null && validTo !== null && validTo <= validFrom) {
      errors.push(problem(row, 'valid_to',
        `valid_to (${validTo}) is not after valid_from (${validFrom}). valid_to is EXCLUSIVE — ` +
        `for a menu whose last day is ${validTo}, write the day after`));
    }

    const record = {
      __row: row.__row,
      menuCode,
      menuName: row.menu_name || menuCode,
      kitchenCode: kitchen ? kitchen.toLowerCase() : null,
      dishName,
      pricePaise: paise(row, 'price_paise', errors),
      availableDays: parseWeekdays(row, 'available_days', errors, { optional: true }) ?? [1, 2, 3, 4, 5, 6],
      schoolCode: (row.school_code || '').toLowerCase() || null,
      validFrom,
      validTo,
      sortOrder: integer(row, 'sort_order', errors, { optional: true, min: 0, max: 32767 }) ?? 0,
    };

    if (menuCode !== null && dishName !== null) {
      const key = `${menuCode}::${dishName.toLowerCase()}`;
      if (seen.has(key)) {
        errors.push(problem(row, 'dish_name',
          `"${dishName}" already appears on menu "${menuCode}" at row ${seen.get(key)}. ` +
          `A dish can only be on a menu once — use available_days if it varies by day`));
      } else {
        seen.set(key, row.__row);
      }
    }

    if (errors.length === before) records.push(record);
  }

  return { records, errors };
}

/**
 * Break windows — `E05-30`, `P19`. One row per window per school.
 *
 * **A blank time is refused, loudly, with the shape to copy.** `--export-breaks` writes template
 * rows for every school that has none, with the labels filled in and the times deliberately left
 * empty, so this is the message an operator sees on their first dry run. Pre-filling those times
 * with another school's would be inventing a time nobody agreed to — which is exactly what
 * `catalogue.sql` refused to do from the legacy option set, and for the same reason.
 */
export function validateBreakTimes(rows) {
  const errors = [];
  const records = [];
  const seen = new Map();

  for (const row of rows) {
    const before = errors.length;

    const schoolCode = (required(row, 'school_code', errors) ?? '').toLowerCase() || null;
    const label = required(row, 'label', errors);
    const startsAt = time(row, 'starts_at', errors);
    const endsAt = time(row, 'ends_at', errors);

    if (startsAt !== null && endsAt !== null && endsAt <= startsAt) {
      errors.push(problem(row, 'ends_at',
        `ends_at (${endsAt}) is not after starts_at (${startsAt}). A window with no duration is ` +
        `not a window`));
    }

    /**
     * `break_time` is unique on (school_id, code).
     *
     * An explicit `code` wins, because that is what `--export-breaks` writes and it is the only
     * thing that makes the round trip lossless: production's codes are `break-1` and `break-2`
     * while its labels are `"10:40AM - 11:15AM"`, so deriving from the label matched nothing and
     * re-importing an untouched export **created duplicate windows**.
     *
     * Derived from the label only when absent — a template row, where an operator typing
     * "Morning break" should not also have to invent an identifier.
     */
    const given = (row.code ?? '').trim().toLowerCase();
    const code = given !== ''
      ? given
      : label === null
        ? null
        : label.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

    const record = {
      __row: row.__row,
      schoolCode,
      code,
      label,
      startsAt,
      endsAt,
      // Ordered by start time unless told otherwise. The kitchen reads these in the order the day
      // happens, not the order somebody typed them.
      sortOrder: integer(row, 'sort_order', errors, { optional: true, min: 0, max: 32767 }),
      isActive: row.is_active === undefined || row.is_active === ''
        ? null
        : row.is_active.toLowerCase() !== 'false',
    };

    if (schoolCode !== null && code !== null) {
      const key = `${schoolCode}::${code}`;
      if (seen.has(key)) {
        errors.push(problem(row, 'label',
          `"${label}" already appears on row ${seen.get(key)} for this school. Two windows with ` +
          `the same name are one window typed twice`));
      } else {
        seen.set(key, row.__row);
      }
    }

    if (errors.length === before) records.push(record);
  }

  return { records, errors };
}

export const VALIDATORS = {
  schools: validateSchools,
  dishes: validateDishes,
  menu: validateMenuItems,
  breaks: validateBreakTimes,
};
