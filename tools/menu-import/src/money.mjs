// Price -> integer paise. Non-negotiable #3: no float ever touches money.
//
// Strings are parsed decimally (never via parseFloat), so "₹1,20,500.05" becomes
// 12050005 by integer arithmetic. Numeric cells cannot avoid float — Excel hands us an
// IEEE double — so they are rounded to the nearest paisa and rejected if the rounding
// moved anything real.

const CURRENCY = /(?:^|\s)(?:₹|rs\.?|inr)\s*/gi
const DECIMAL = /^(\d+)(?:\.(\d+))?$/

/** Prices above this are almost certainly a typo (a school lunch is not ₹10,000). */
export const SANITY_CEILING_PAISE = 1_000_000

/**
 * @param {string|number|null} raw
 * @returns {{ok: true, paise: number} | {ok: false, code: string, message: string}}
 */
export function toPaise(raw) {
  if (raw == null) return fail('price_missing', 'the cell is empty')

  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return fail('price_unparseable', `"${raw}" is not a finite number`)
    const scaled = raw * 100
    const rounded = Math.round(scaled)
    if (Math.abs(scaled - rounded) > 1e-6) {
      return fail(
        'price_sub_paisa',
        `${raw} is not a whole number of paise, so it cannot be stored without losing money`,
      )
    }
    return guard(rounded)
  }

  const text = String(raw).trim()
  if (text === '') return fail('price_missing', 'the cell is blank')

  const cleaned = text
    .replace(CURRENCY, '')
    .replace(/[\s\u00A0]/g, '')
    .replace(/[\u00A0\u202F\u2009]/g, '') // non-breaking spaces Excel likes to paste
    .replace(/,/g, '') // handles both 1,200 and the Indian 1,20,500
    .replace(/^\+/, '')

  const match = DECIMAL.exec(cleaned)
  if (!match) {
    return fail('price_unparseable', `"${text}" is not a number`)
  }
  const [, whole, fraction = ''] = match
  if (fraction.length > 2) {
    return fail('price_sub_paisa', `"${text}" has more than two decimal places`)
  }

  const paise = Number(whole) * 100 + Number(fraction.padEnd(2, '0') || '0')
  if (!Number.isSafeInteger(paise)) return fail('price_unparseable', `"${text}" is too large`)
  return guard(paise)
}

function guard(paise) {
  if (paise < 0) return fail('price_negative', 'a negative price is never valid')
  if (paise === 0) {
    // A zero here is far more likely a blank-ish cell than a genuinely free dish. The
    // E04-04 preview is where a real free item gets added by hand.
    return fail('price_not_positive', 'the price is zero')
  }
  return { ok: true, paise }
}

function fail(code, message) {
  return { ok: false, code, message }
}

/** For human-readable reports only. Never used to compute anything. */
export function formatPaise(paise) {
  const sign = paise < 0 ? '-' : ''
  const abs = Math.abs(paise)
  return `${sign}₹${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}
