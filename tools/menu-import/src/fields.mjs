// Coercion for the non-money scalar columns.

/**
 * The legacy `Categories` option set, minus "All" — docs/data-model.md §3.2 is explicit
 * that "All" is a UI affordance and is not migrated.
 */
export const KNOWN_CATEGORIES = new Map(Object.entries({
  breakfast: 'breakfast',
  bakery: 'bakery',
  sandwich: 'sandwich',
  sandwiches: 'sandwich',
  salad: 'salads',
  salads: 'salads',
  continental: 'continental',
  'quick bites': 'quick_bites',
  quickbites: 'quick_bites',
  'quick bite': 'quick_bites',
  meal: 'meals',
  meals: 'meals',
  drink: 'drinks',
  drinks: 'drinks',
  beverage: 'drinks',
  beverages: 'drinks',
}))

/** Present in the legacy option set but explicitly not migrated. */
export const NON_MIGRATABLE_CATEGORIES = new Set(['all'])

export function toCategoryCode(raw) {
  const text = raw == null ? '' : String(raw).trim()
  if (text === '') return { ok: false, code: 'category_missing', message: 'the cell is empty' }

  const key = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')
  if (NON_MIGRATABLE_CATEGORIES.has(key)) {
    return {
      ok: false,
      code: 'category_not_migratable',
      message: `"${text}" is a browse affordance, not a category (docs/data-model.md §3.2)`,
    }
  }
  if (KNOWN_CATEGORIES.has(key)) return { ok: true, category: KNOWN_CATEGORIES.get(key) }

  return {
    ok: false,
    code: 'category_unknown',
    message: `"${text}" is not one of the seeded categories`,
    // What it would be called if Andy decides to add it.
    proposedCode: key.replace(/\s+/g, '_'),
  }
}

/**
 * Calories were stored as text in the legacy app, and docs/data-model.md §6.1 is explicit:
 * parse to an integer, and leave null when unparseable **rather than guessing**. A range
 * ("350-400") is therefore null, not a midpoint.
 */
export function toCalories(raw) {
  if (raw == null) return { value: null }
  if (typeof raw === 'number') {
    if (!Number.isInteger(raw)) return { value: Math.round(raw), warning: 'calories_rounded' }
    return sanityCheckCalories(raw)
  }

  const text = String(raw).trim()
  if (text === '') return { value: null }
  if (/^(?:n\/?a|nil|none|-+|\?)$/i.test(text)) return { value: null }

  if (/\d\s*(?:-|–|to)\s*\d/.test(text)) {
    return { value: null, warning: 'calories_range', detail: `"${text}" is a range, not a value` }
  }

  const digits = text.match(/\d+(?:\.\d+)?/g)
  if (!digits || digits.length !== 1) {
    return { value: null, warning: 'calories_unparseable', detail: `"${text}" has no single number in it` }
  }
  return sanityCheckCalories(Math.round(Number(digits[0])))
}

function sanityCheckCalories(value) {
  if (value < 0 || value > 5000) {
    return { value: null, warning: 'calories_implausible', detail: `${value} kcal for one portion` }
  }
  return { value }
}

export function toText(raw, { maxLength = null } = {}) {
  if (raw == null) return null
  const text = String(raw).replace(/\s+/g, ' ').trim()
  if (text === '') return null
  if (maxLength !== null && text.length > maxLength) return text.slice(0, maxLength)
  return text
}

const DAY_CODES = new Map(Object.entries({
  mon: 'mon', monday: 'mon', tue: 'tue', tues: 'tue', tuesday: 'tue',
  wed: 'wed', weds: 'wed', wednesday: 'wed', thu: 'thu', thur: 'thu', thurs: 'thu',
  thursday: 'thu', fri: 'fri', friday: 'fri', sat: 'sat', saturday: 'sat',
  sun: 'sun', sunday: 'sun',
}))

/** Optional column (E04-05). The legacy option set is Mon–Sat; Sun is accepted. */
export function toAvailableDays(raw) {
  if (raw == null || String(raw).trim() === '') return { value: null, unknown: [] }
  const days = []
  const unknown = []
  for (const piece of String(raw).split(/[,;/|&\s]+/)) {
    const key = piece.toLowerCase().replace(/[^a-z]/g, '')
    if (key === '') continue
    if (key === 'all' || key === 'daily' || key === 'everyday') {
      return { value: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'], unknown: [] }
    }
    if (DAY_CODES.has(key)) {
      const code = DAY_CODES.get(key)
      if (!days.includes(code)) days.push(code)
    } else {
      unknown.push(piece)
    }
  }
  const order = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
  days.sort((a, b) => order.indexOf(a) - order.indexOf(b))
  return { value: days.length ? days : null, unknown }
}
