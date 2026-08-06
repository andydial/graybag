// Builds a minimal .xlsx in memory so the tests exercise the real ZIP + XML reading
// path rather than a hand-made array of rows. Test-only; the importer never uses it.

import { writeZip } from '../src/zip.mjs'
import { escapeXmlText, columnIndexToLetter } from '../src/xlsx.mjs'

/**
 * @param {Array<{name: string, rows: Array<Array<any>>}>} sheets
 * @param {{inlineStrings?: boolean}} [options] force inline strings instead of the
 *   shared-string table, so both reader paths are covered
 * @returns {Buffer}
 */
export function makeWorkbook(sheets, options = {}) {
  const inline = options.inlineStrings === true
  const sharedStrings = []
  const sharedIndex = new Map()

  const intern = (value) => {
    if (!sharedIndex.has(value)) {
      sharedIndex.set(value, sharedStrings.length)
      sharedStrings.push(value)
    }
    return sharedIndex.get(value)
  }

  const sheetParts = sheets.map((sheet, sheetNo) => ({
    name: `xl/worksheets/sheet${sheetNo + 1}.xml`,
    data: sheetXml(sheet.rows, inline, intern),
  }))

  const files = [
    {
      name: '[Content_Types].xml',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        sheets
          .map(
            (_, i) =>
              `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
          )
          .join('') +
        (inline
          ? ''
          : '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>') +
        '</Types>',
    },
    {
      name: '_rels/.rels',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>',
    },
    {
      name: 'xl/workbook.xml',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
        sheets
          .map((s, i) => `<sheet name="${escapeXmlText(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
          .join('') +
        '</sheets></workbook>',
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        sheets
          .map(
            (_, i) =>
              `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
          )
          .join('') +
        (inline
          ? ''
          : `<Relationship Id="rIdSS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>`) +
        '</Relationships>',
    },
    ...sheetParts,
  ]

  if (!inline) {
    files.push({
      name: 'xl/sharedStrings.xml',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedStrings.length}" uniqueCount="${sharedStrings.length}">` +
        sharedStrings.map((s) => `<si><t xml:space="preserve">${escapeXmlText(s)}</t></si>`).join('') +
        '</sst>',
    })
  }

  return writeZip(files)
}

function sheetXml(rows, inline, intern) {
  const body = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((value, colIndex) => cellXml(value, columnIndexToLetter(colIndex) + (rowIndex + 1), inline, intern))
        .filter(Boolean)
        .join('')
      return `<row r="${rowIndex + 1}">${cells}</row>`
    })
    .join('')
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetData>${body}</sheetData></worksheet>`
  )
}

function cellXml(value, ref, inline, intern) {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'number') return `<c r="${ref}"><v>${value}</v></c>`
  if (typeof value === 'boolean') return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`
  const text = String(value)
  if (inline) return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXmlText(text)}</t></is></c>`
  return `<c r="${ref}" t="s"><v>${intern(text)}</v></c>`
}
