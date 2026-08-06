import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readWorkbook, columnLetterToIndex, columnIndexToLetter, decodeXmlText } from '../src/xlsx.mjs'
import { makeWorkbook } from './make-workbook.mjs'

test('column letters convert both ways', () => {
  assert.equal(columnLetterToIndex('A'), 0)
  assert.equal(columnLetterToIndex('Z'), 25)
  assert.equal(columnLetterToIndex('AA'), 26)
  assert.equal(columnLetterToIndex('AZ'), 51)
  for (const i of [0, 1, 25, 26, 27, 51, 52, 701, 702]) {
    assert.equal(columnLetterToIndex(columnIndexToLetter(i)), i)
  }
})

test('decodes XML entities including numeric ones', () => {
  assert.equal(decodeXmlText('a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;'), `a & b <c> "d" 'e'`)
  assert.equal(decodeXmlText('&#8377;120'), '₹120')
  assert.equal(decodeXmlText('&#x20B9;120'), '₹120')
})

for (const inlineStrings of [false, true]) {
  const label = inlineStrings ? 'inline strings' : 'shared strings'

  test(`reads a sheet using ${label}`, () => {
    const buf = makeWorkbook(
      [{ name: 'Menu', rows: [['Menu Item', 'Price'], ['Veg Sandwich', 60], ['Cold Coffee', 75.5]] }],
      { inlineStrings },
    )
    const { sheetName, rows } = readWorkbook(buf)
    assert.equal(sheetName, 'Menu')
    assert.deepEqual(rows[0], ['Menu Item', 'Price'])
    assert.deepEqual(rows[1], ['Veg Sandwich', 60])
    assert.deepEqual(rows[2], ['Cold Coffee', 75.5])
  })
}

test('missing cells become null and every row is the same width', () => {
  const buf = makeWorkbook([
    { name: 'Menu', rows: [['A', 'B', 'C'], ['one', null, 'three'], ['solo']] },
  ])
  const { rows } = readWorkbook(buf)
  assert.deepEqual(rows[1], ['one', null, 'three'])
  assert.deepEqual(rows[2], ['solo', null, null])
})

test('text containing XML metacharacters survives the round trip', () => {
  const buf = makeWorkbook([{ name: 'Menu', rows: [['Menu Item'], ['Fish & "Chips" <special>']] }])
  const { rows } = readWorkbook(buf)
  assert.equal(rows[1][0], 'Fish & "Chips" <special>')
})

test('selects a named sheet and lists what is available', () => {
  const buf = makeWorkbook([
    { name: 'Notes', rows: [['ignore me']] },
    { name: 'Menu 2026', rows: [['Menu Item'], ['Idli Sambar']] },
  ])
  const { sheetNames, rows } = readWorkbook(buf, { sheet: 'Menu 2026' })
  assert.deepEqual(sheetNames, ['Notes', 'Menu 2026'])
  assert.equal(rows[1][0], 'Idli Sambar')
  assert.throws(() => readWorkbook(buf, { sheet: 'Nope' }), /Available: Notes, Menu 2026/)
})
