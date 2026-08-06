// Finding the header row and mapping its labels onto canonical fields.
//
// The documented shape (planning/backlog/E04-menu-domain.md) is:
//   Item No. | Menu Item | Description | Ingredients | Calories | Portion/Weight |
//   Allergens | Category | Category - ORIG | Price
// Real spreadsheets drift — a title row above the header, a renamed column, a stray
// notes column — so headers are matched by alias rather than by position, and anything
// unrecognised is reported instead of dropped.

/** Canonical field -> accepted header labels, already normalised. */
export const COLUMN_ALIASES = {
  item_no: ['item no', 'itemno', 'item number', 'item', 'sr no', 's no', 'sl no', 'serial no', 'no', 'code'],
  name: ['menu item', 'menu items', 'dish', 'dish name', 'name', 'item name', 'product'],
  description: ['description', 'desc', 'details'],
  ingredients: ['ingredients', 'ingredient', 'ingredients list'],
  calories: ['calories', 'calorie', 'calorie count', 'kcal', 'energy', 'energy kcal'],
  portion: ['portion weight', 'portion', 'weight', 'portion size', 'serving size', 'quantity', 'qty'],
  allergens: ['allergens', 'allergen', 'allergies', 'allergen info', 'allergen information'],
  category: ['category', 'categories', 'section', 'menu category'],
  category_orig: ['category orig', 'category original', 'orig category', 'category old'],
  price: ['price', 'price inr', 'price rs', 'rate', 'mrp', 'amount', 'cost', 'selling price'],
  // Optional, per E04-05. Absent from the legacy file; accepted if a future one has them.
  image_filename: ['image filename', 'image', 'image file', 'photo', 'photo filename', 'image name'],
  available_days: ['available days', 'days', 'days available', 'available on'],
}

/** Fields whose absence makes the file unusable rather than merely incomplete. */
export const REQUIRED_COLUMNS = ['name', 'price', 'category']

/** Read from the file, then deliberately discarded (E04-05). */
export const DROPPED_COLUMNS = ['category_orig']

const ALIAS_LOOKUP = (() => {
  const map = new Map()
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    for (const alias of aliases) {
      // "item" is an alias of both item_no and name; the longer, more specific list wins
      // by being registered first, so never overwrite an existing entry.
      if (!map.has(alias)) map.set(alias, field)
    }
  }
  return map
})()

export function normaliseHeader(value) {
  if (value == null) return ''
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function matchHeaderCell(value) {
  const key = normaliseHeader(value)
  if (key === '') return null
  return ALIAS_LOOKUP.get(key) ?? null
}

/**
 * Score every row in the search window and take the best. A menu sheet nearly always
 * has a title and sometimes a blank row above the real header, and hard-coding "row 1"
 * is the single most common way a spreadsheet importer fails on the second file it sees.
 *
 * @param {Array<Array<any>>} rows
 * @param {{searchDepth?: number}} [options]
 * @returns {{
 *   headerRowIndex: number,
 *   mapped: Record<string, number>,
 *   ignored: Array<{label: string, columnIndex: number, field: string}>,
 *   unknown: Array<{label: string, columnIndex: number}>,
 *   duplicates: Array<{field: string, columnIndexes: number[]}>,
 *   missingRequired: string[],
 *   missingOptional: string[],
 * }}
 */
export function detectColumns(rows, options = {}) {
  const searchDepth = Math.min(options.searchDepth ?? 20, rows.length)

  let best = null
  for (let i = 0; i < searchDepth; i++) {
    const hits = rows[i].map(matchHeaderCell)
    const score = hits.filter(Boolean).length
    if (score > 0 && (best === null || score > best.score)) best = { index: i, hits, score }
  }

  if (best === null) {
    throw new Error(
      `no header row found in the first ${searchDepth} rows — expected labels such as ` +
        `"Menu Item", "Category", "Allergens", "Price"`,
    )
  }

  const byField = new Map()
  const unknown = []
  best.hits.forEach((field, columnIndex) => {
    const label = rows[best.index][columnIndex]
    if (field === null) {
      if (normaliseHeader(label) !== '') unknown.push({ label: String(label), columnIndex })
      return
    }
    if (!byField.has(field)) byField.set(field, [])
    byField.get(field).push(columnIndex)
  })

  const duplicates = []
  const mapped = {}
  const ignored = []
  for (const [field, columnIndexes] of byField) {
    if (columnIndexes.length > 1) duplicates.push({ field, columnIndexes })
    const columnIndex = columnIndexes[0]
    if (DROPPED_COLUMNS.includes(field)) {
      ignored.push({ label: String(rows[best.index][columnIndex]), columnIndex, field })
    } else {
      mapped[field] = columnIndex
    }
  }

  const optional = Object.keys(COLUMN_ALIASES).filter(
    (f) => !REQUIRED_COLUMNS.includes(f) && !DROPPED_COLUMNS.includes(f),
  )

  return {
    headerRowIndex: best.index,
    mapped,
    ignored,
    unknown,
    duplicates,
    missingRequired: REQUIRED_COLUMNS.filter((f) => !(f in mapped)),
    missingOptional: optional.filter((f) => !(f in mapped)),
  }
}
