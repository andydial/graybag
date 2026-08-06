// Minimal .xlsx reader: enough of SpreadsheetML to get a sheet out as a grid of
// strings and numbers. No styles, no formulas, no dates — a menu sheet has none of
// them, and guessing a date format wrong is worse than not reading dates at all.

import { readZip } from './zip.mjs'

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

export function decodeXmlText(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return body in ENTITIES ? ENTITIES[body] : match
  })
}

export function escapeXmlText(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** "A" -> 0, "Z" -> 25, "AA" -> 26 */
export function columnLetterToIndex(letters) {
  let n = 0
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

/** 0 -> "A", 26 -> "AA" */
export function columnIndexToLetter(index) {
  let n = index + 1
  let out = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    out = String.fromCharCode(65 + rem) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`))
  return m ? decodeXmlText(m[1]) : null
}

function collectText(xml) {
  // Rich-text runs split one string across several <t> elements; phonetic hints
  // (<rPh>) are pronunciation aids and are not part of the value.
  const withoutPhonetics = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '')
  let out = ''
  for (const m of withoutPhonetics.matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g)) {
    out += m[1] === undefined ? '' : decodeXmlText(m[1])
  }
  return out
}

function parseSharedStrings(xml) {
  if (!xml) return []
  const items = []
  for (const m of xml.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)) {
    items.push(m[1] === undefined ? '' : collectText(m[1]))
  }
  return items
}

function parseWorkbook(entries) {
  const workbookXml = textOf(entries, 'xl/workbook.xml')
  if (!workbookXml) throw new Error('xlsx: xl/workbook.xml is missing — not a workbook')

  const rels = new Map()
  const relsXml = textOf(entries, 'xl/_rels/workbook.xml.rels') ?? ''
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], 'Id')
    const target = attr(m[0], 'Target')
    if (id && target) rels.set(id, target.replace(/^\/?xl\//, '').replace(/^\.\//, ''))
  }

  const sheets = []
  for (const m of workbookXml.matchAll(/<sheet\b[^>]*>/g)) {
    const name = attr(m[0], 'name')
    const rid = attr(m[0], 'r:id') ?? attr(m[0], 'id')
    const target = rid && rels.has(rid) ? rels.get(rid) : `worksheets/sheet${sheets.length + 1}.xml`
    sheets.push({ name: name ?? `Sheet${sheets.length + 1}`, path: `xl/${target}` })
  }
  if (sheets.length === 0) throw new Error('xlsx: the workbook declares no sheets')
  return sheets
}

function textOf(entries, name) {
  const buf = entries.get(name)
  return buf ? buf.toString('utf8') : null
}

/**
 * Parse one worksheet into a dense grid. Missing cells become `null`, so every row
 * has the same length and a column index means the same thing on every row.
 * @returns {Array<Array<string|number|boolean|null>>}
 */
function parseSheet(xml, sharedStrings) {
  const rows = []
  let widest = 0

  for (const rowMatch of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rowNumber = Number(attr(`<row${rowMatch[1]}>`, 'r') ?? rows.length + 1)
    const body = rowMatch[2] ?? ''
    const cells = []

    for (const cellMatch of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const tag = `<c${cellMatch[1]}>`
      const ref = attr(tag, 'r')
      const type = attr(tag, 't') ?? 'n'
      const inner = cellMatch[2] ?? ''
      const index = ref ? columnLetterToIndex(ref.match(/^[A-Za-z]+/)[0]) : cells.length

      while (cells.length < index) cells.push(null)
      cells[index] = readCellValue(type, inner, sharedStrings)
    }

    // Rows are 1-based and sparse: a sheet may jump from row 3 to row 7.
    while (rows.length < rowNumber - 1) rows.push([])
    rows[rowNumber - 1] = cells
    widest = Math.max(widest, cells.length)
  }

  for (const row of rows) while (row.length < widest) row.push(null)
  return rows
}

function readCellValue(type, inner, sharedStrings) {
  if (type === 'inlineStr') {
    const text = collectText(inner)
    return text === '' ? null : text
  }
  const vMatch = inner.match(/<v\b[^>]*?(?:\/>|>([\s\S]*?)<\/v>)/)
  if (!vMatch) return null
  const raw = vMatch[1] === undefined ? '' : decodeXmlText(vMatch[1])

  switch (type) {
    case 's': {
      const value = sharedStrings[Number(raw)]
      return value === undefined || value === '' ? null : value
    }
    case 'str':
      return raw === '' ? null : raw
    case 'b':
      return raw === '1'
    case 'e':
      // An Excel error cell (#N/A, #REF!) is data the human must look at, so it is
      // surfaced as its literal text rather than swallowed to null.
      return raw
    default: {
      if (raw === '') return null
      const n = Number(raw)
      return Number.isFinite(n) ? n : raw
    }
  }
}

/**
 * @param {Buffer} buf raw .xlsx bytes
 * @param {{sheet?: string}} [options] sheet name; defaults to the first sheet
 * @returns {{sheetName: string, sheetNames: string[], rows: Array<Array<any>>}}
 */
export function readWorkbook(buf, options = {}) {
  const entries = readZip(buf)
  const sheets = parseWorkbook(entries)
  const sharedStrings = parseSharedStrings(textOf(entries, 'xl/sharedStrings.xml'))

  let chosen = sheets[0]
  if (options.sheet != null) {
    const found = sheets.find((s) => s.name === options.sheet)
    if (!found) {
      throw new Error(
        `xlsx: no sheet named "${options.sheet}". Available: ${sheets.map((s) => s.name).join(', ')}`,
      )
    }
    chosen = found
  }

  const sheetXml = textOf(entries, chosen.path)
  if (!sheetXml) throw new Error(`xlsx: sheet part "${chosen.path}" is missing from the archive`)

  return {
    sheetName: chosen.name,
    sheetNames: sheets.map((s) => s.name),
    rows: parseSheet(sheetXml, sharedStrings),
  }
}
