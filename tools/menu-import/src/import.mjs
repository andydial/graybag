// The importer proper: workbook bytes in, validated JSON out.
//
// Two rules shape everything here.
//   1. Nothing is ever silently dropped. A row is either a dish in `dishes` or a
//      rejection in `rejected`, and the two counts plus `skipped` account for every
//      row below the header.
//   2. Nothing about a row is guessed. An unparseable calorie count becomes null with
//      a warning; an unrecognised allergen fails the row. Which of the two applies is
//      decided by whether being wrong could hurt someone.

import { readWorkbook } from './xlsx.mjs'
import { detectColumns } from './columns.mjs'
import { toPaise, SANITY_CEILING_PAISE, formatPaise } from './money.mjs'
import { toCategoryCode, toCalories, toText, toAvailableDays, KNOWN_CATEGORIES } from './fields.mjs'
import { parseAllergenCell, ALLERGEN_CODES } from './allergens.mjs'

export const TOOL_VERSION = '0.1.0'

const NAME_MAX = 120

/**
 * @param {Buffer} bytes
 * @param {{
 *   sheet?: string,
 *   sourceName?: string,
 *   allowNewCategories?: boolean,
 *   headerSearchDepth?: number,
 * }} [options]
 */
export function importMenuWorkbook(bytes, options = {}) {
  const { sheetName, sheetNames, rows } = readWorkbook(bytes, { sheet: options.sheet })
  return importRows(rows, { ...options, sheetName, sheetNames })
}

/** Split out from importMenuWorkbook so the row logic is testable without a ZIP. */
export function importRows(rows, options = {}) {
  const columns = detectColumns(rows, { searchDepth: options.headerSearchDepth })

  const fileIssues = []
  if (columns.missingRequired.length > 0) {
    throw new Error(
      `the sheet is missing required column(s): ${columns.missingRequired.join(', ')}. ` +
        `Found: ${Object.keys(columns.mapped).join(', ') || 'nothing'}`,
    )
  }
  if (columns.duplicates.length > 0) {
    throw new Error(
      `ambiguous headers — ${columns.duplicates
        .map((d) => `${d.field} appears in columns ${d.columnIndexes.join(', ')}`)
        .join('; ')}. Rename one of them and re-run.`,
    )
  }
  for (const col of columns.unknown) {
    fileIssues.push({
      code: 'unknown_column',
      message: `column "${col.label}" was not recognised and has been ignored`,
    })
  }
  for (const col of columns.ignored) {
    fileIssues.push({
      code: 'dropped_column',
      message: `column "${col.label}" is dropped deliberately (E04-05)`,
    })
  }
  for (const field of columns.missingOptional) {
    fileIssues.push({ code: 'missing_optional_column', message: `no "${field}" column in this sheet` })
  }
  // DM-17: veg / non-veg / egg is not a column in this format and cannot be imported.
  fileIssues.push({
    code: 'food_type_absent',
    message:
      'food_type (veg / non_veg / egg) is not in this file and is left null on every dish — [DM-17]',
  })

  const dishes = []
  const rejected = []
  const warnings = []
  const skipped = []

  const seenItemNo = new Map()
  const seenName = new Map()
  const allergenStats = newAllergenStats()

  for (let i = columns.headerRowIndex + 1; i < rows.length; i++) {
    const rowNumber = i + 1 // 1-based, matching what Excel shows the human
    const raw = readRow(rows[i], columns.mapped)

    if (isBlank(rows[i])) {
      skipped.push({ row: rowNumber, reason: 'blank_row' })
      continue
    }

    const outcome = validateRow(raw, {
      rowNumber,
      allowNewCategories: options.allowNewCategories === true,
      allergenStats,
    })

    for (const w of outcome.warnings) warnings.push({ row: rowNumber, ...w })

    if (outcome.errors.length > 0) {
      rejected.push({
        row: rowNumber,
        name: raw.name == null ? null : String(raw.name),
        errors: outcome.errors,
        hints: outcome.hints,
        raw,
      })
      continue
    }

    const dish = outcome.dish
    // Duplicate detection runs on accepted rows only — a row already failing for a
    // missing price should not also be reported as a duplicate of itself on a re-run.
    const nameKey = dish.name.toLowerCase()
    const duplicateErrors = []
    if (seenName.has(nameKey)) {
      duplicateErrors.push({
        code: 'duplicate_name',
        field: 'name',
        message: `"${dish.name}" already appears on row ${seenName.get(nameKey)}; ` +
          'dish is unique on (kitchen_id, lower(name))',
        value: dish.name,
      })
    }
    if (dish.item_no != null && seenItemNo.has(dish.item_no)) {
      duplicateErrors.push({
        code: 'duplicate_item_no',
        field: 'item_no',
        message: `item no. "${dish.item_no}" already appears on row ${seenItemNo.get(dish.item_no)}`,
        value: dish.item_no,
      })
    }

    if (duplicateErrors.length > 0) {
      rejected.push({ row: rowNumber, name: dish.name, errors: duplicateErrors, hints: [], raw })
      continue
    }

    seenName.set(nameKey, rowNumber)
    if (dish.item_no != null) seenItemNo.set(dish.item_no, rowNumber)
    dishes.push({ row: rowNumber, ...dish })
  }

  return {
    meta: {
      tool: 'graybag-menu-import',
      version: TOOL_VERSION,
      source_file: options.sourceName ?? null,
      sheet: options.sheetName ?? null,
      sheets_available: options.sheetNames ?? null,
      header_row: columns.headerRowIndex + 1,
      rows_below_header: Math.max(0, rows.length - columns.headerRowIndex - 1),
      accepted: dishes.length,
      rejected: rejected.length,
      skipped: skipped.length,
      warnings: warnings.length,
    },
    columns: {
      mapped: columns.mapped,
      dropped: columns.ignored,
      unrecognised: columns.unknown,
      missing_optional: columns.missingOptional,
    },
    file_issues: fileIssues,
    dishes,
    rejected,
    warnings,
    skipped,
    allergen_report: summariseAllergens(allergenStats),
  }
}

function readRow(row, mapped) {
  const raw = {}
  for (const [field, index] of Object.entries(mapped)) raw[field] = row[index] ?? null
  return raw
}

function isBlank(row) {
  return row.every((cell) => cell == null || String(cell).trim() === '')
}

function newAllergenStats() {
  return {
    cellValues: new Map(),
    fragments: new Map(),
    unknown: new Map(),
    uncoded: new Map(),
    codes: new Map(),
    blankCells: 0,
    declaredNone: 0,
  }
}

function validateRow(raw, { rowNumber, allowNewCategories, allergenStats }) {
  const errors = []
  const warnings = []
  const hints = []

  const name = toText(raw.name)
  if (name === null) {
    errors.push({ code: 'name_missing', field: 'name', message: 'a dish must have a name', value: null })
  } else if (name.length > NAME_MAX) {
    errors.push({
      code: 'name_too_long',
      field: 'name',
      message: `${name.length} characters; the limit is ${NAME_MAX}`,
      value: name,
    })
  }

  // A row with only a name and nothing else is usually a section heading typed into the
  // sheet. It still fails validation — never silently dropped — but say so, because the
  // human reading the report needs to know it is not a real dish.
  const populated = Object.entries(raw).filter(([, v]) => v != null && String(v).trim() !== '')
  if (name !== null && populated.length === 1 && populated[0][0] === 'name') {
    const looksLikeCategory = KNOWN_CATEGORIES.has(name.toLowerCase())
    hints.push(
      looksLikeCategory
        ? `row ${rowNumber} has only a name and it matches a category — this looks like a section heading, not a dish`
        : `row ${rowNumber} has only a name filled in`,
    )
  }

  const price = toPaise(raw.price)
  if (!price.ok) {
    errors.push({ code: price.code, field: 'price', message: price.message, value: raw.price })
  } else if (price.paise > SANITY_CEILING_PAISE) {
    warnings.push({
      code: 'price_implausible',
      field: 'price',
      message: `${formatPaise(price.paise)} is unusually high for a school menu item`,
      value: raw.price,
    })
  }

  const category = toCategoryCode(raw.category)
  if (!category.ok) {
    if (category.code === 'category_unknown' && allowNewCategories) {
      warnings.push({
        code: 'category_new',
        field: 'category',
        message: `${category.message} — accepted as "${category.proposedCode}" because ` +
          '--allow-new-categories was passed; it must be seeded before import',
        value: raw.category,
      })
    } else {
      errors.push({
        code: category.code,
        field: 'category',
        message: category.message +
          (category.code === 'category_unknown'
            ? `. Seeded categories: ${[...new Set(KNOWN_CATEGORIES.values())].join(', ')}`
            : ''),
        value: raw.category,
      })
    }
  }

  const allergens = parseAllergenCell(raw.allergens)
  recordAllergenStats(allergenStats, raw.allergens, allergens)

  if (allergens.blank) {
    // Blank is not "none". Someone who did not fill the cell in has told us nothing,
    // and shipping that as "no allergens" is how an allergy goes unwarned.
    warnings.push({
      code: 'allergens_blank',
      field: 'allergens',
      message: 'the allergens cell is empty — this is recorded as "unknown", not as "none". ' +
        'Write "None" explicitly if the kitchen has checked',
      value: null,
    })
  }
  for (const token of allergens.unknown) {
    errors.push({
      code: 'allergen_unknown',
      field: 'allergens',
      message: `"${token}" does not map to any seeded allergen code — [DM-13]`,
      value: token,
    })
  }
  for (const item of allergens.uncoded) {
    errors.push({
      code: 'allergen_uncoded',
      field: 'allergens',
      message: `"${item.text}" is a real allergen (${item.family}) with no code in the ` +
        'seed list — it must be added before this row can be imported. [DM-13]',
      value: item.text,
    })
  }
  for (const code of allergens.conflicts) {
    warnings.push({
      code: 'allergen_presence_conflict',
      field: 'allergens',
      message: `"${code}" is declared both as contains and as may_contain; recorded as contains`,
      value: code,
    })
  }

  const calories = toCalories(raw.calories)
  if (calories.warning) {
    warnings.push({
      code: calories.warning,
      field: 'calories',
      message: `${calories.detail ?? 'not parseable'} — stored as null rather than guessed`,
      value: raw.calories,
    })
  }

  const days = toAvailableDays(raw.available_days)
  for (const token of days.unknown) {
    warnings.push({
      code: 'available_day_unknown',
      field: 'available_days',
      message: `"${token}" is not a day of the week and was ignored`,
      value: token,
    })
  }

  if (errors.length > 0) return { errors, warnings, hints, dish: null }

  return {
    errors,
    warnings,
    hints,
    dish: {
      item_no: toText(raw.item_no),
      name,
      description: toText(raw.description),
      ingredients_text: toText(raw.ingredients),
      calories_kcal: calories.value,
      portion_text: toText(raw.portion),
      category_code: category.ok ? category.category : category.proposedCode,
      // [DM-17] — not in this file format, and not inferable from a dish name.
      food_type: null,
      // [DM-20] — whether this includes GST is undecided, so the importer records the
      // number and refuses to imply either reading.
      price_paise: price.paise,
      price_is_tax_inclusive: null,
      allergens: allergens.tags,
      allergens_declared_none: allergens.declaredNone,
      allergens_raw: raw.allergens == null ? null : String(raw.allergens).trim(),
      image_filename: toText(raw.image_filename),
      available_days: days.value,
    },
  }
}

function recordAllergenStats(stats, rawCell, parsed) {
  const cellText = rawCell == null ? '' : String(rawCell).trim()
  if (parsed.blank) stats.blankCells++
  else bump(stats.cellValues, cellText)
  if (parsed.declaredNone) stats.declaredNone++

  for (const fragment of parsed.fragments) {
    const key = fragment.normalised
    if (key === '') continue
    const entry = stats.fragments.get(key) ?? {
      fragment: key,
      count: 0,
      outcome: fragment.outcome,
      code: fragment.code ?? null,
      family: fragment.family ?? null,
      examples: [],
    }
    entry.count++
    if (entry.examples.length < 3 && !entry.examples.includes(fragment.text)) {
      entry.examples.push(fragment.text)
    }
    stats.fragments.set(key, entry)
  }
  for (const token of parsed.unknown) bump(stats.unknown, token)
  for (const item of parsed.uncoded) bump(stats.uncoded, `${item.text} (${item.family})`)
  for (const tag of parsed.tags) bump(stats.codes, tag.code)
}

function bump(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1)
}

function toSortedPairs(map, keyName) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .map(([key, count]) => ({ [keyName]: key, count }))
}

/**
 * This block is the answer to [DM-13]. `unmapped` and `uncoded` being empty is the
 * condition for freezing the `allergen` seed list; `codes_unused` says which of the
 * twelve the real data never exercises.
 */
function summariseAllergens(stats) {
  const used = new Set(stats.codes.keys())
  return {
    blank_cells: stats.blankCells,
    declared_none: stats.declaredNone,
    distinct_cell_values: toSortedPairs(stats.cellValues, 'value'),
    fragments: [...stats.fragments.values()].sort(
      (a, b) => b.count - a.count || a.fragment.localeCompare(b.fragment),
    ),
    codes_used: toSortedPairs(stats.codes, 'code'),
    codes_unused: ALLERGEN_CODES.filter((c) => !used.has(c)),
    unmapped: toSortedPairs(stats.unknown, 'token'),
    uncoded: toSortedPairs(stats.uncoded, 'token'),
  }
}
