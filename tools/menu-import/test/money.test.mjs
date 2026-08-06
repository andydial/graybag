import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toPaise, formatPaise } from '../src/money.mjs'

const accepts = (input, paise) =>
  test(`${JSON.stringify(input)} -> ${paise} paise`, () => {
    assert.deepEqual(toPaise(input), { ok: true, paise })
  })

const rejects = (input, code) =>
  test(`${JSON.stringify(input)} is rejected as ${code}`, () => {
    const result = toPaise(input)
    assert.equal(result.ok, false)
    assert.equal(result.code, code)
  })

accepts(60, 6000)
accepts(75.5, 7550)
accepts(0.05, 5)
accepts('60', 6000)
accepts('60.00', 6000)
accepts('60.5', 6050)
accepts('60.05', 6005)
accepts('₹60', 6000)
accepts('Rs. 60.50', 6050)
accepts('Rs 60', 6000)
accepts('INR 60', 6000)
accepts(' 60 ', 6000)
accepts('1,200', 120000)
accepts('1,20,500.05', 12050005) // Indian digit grouping
accepts('+60', 6000)

rejects(null, 'price_missing')
rejects('', 'price_missing')
rejects('   ', 'price_missing')
rejects('free', 'price_unparseable')
rejects('N/A', 'price_unparseable')
rejects('60 or 70', 'price_unparseable')
rejects('60.005', 'price_sub_paisa')
rejects(60.005, 'price_sub_paisa')
rejects('-60', 'price_unparseable') // the minus is stripped by no rule, so it never parses
rejects(-60, 'price_negative')
rejects(0, 'price_not_positive')
rejects('0.00', 'price_not_positive')
rejects(Number.NaN, 'price_unparseable')

test('the classic float trap: 0.1 + 0.2 style values do not leak into paise', () => {
  // 8.15 * 100 is 814.9999999999999 in IEEE 754. Rounding must give 815, not 814.
  assert.deepEqual(toPaise(8.15), { ok: true, paise: 815 })
  assert.deepEqual(toPaise('8.15'), { ok: true, paise: 815 })
})

test('a genuine sub-paisa price is rejected rather than quietly rounded', () => {
  // Excel cannot hold ₹1.005 exactly either, but the point stands: a price that is not
  // a whole number of paise is a spreadsheet error, and rounding it silently is how a
  // half-paisa discrepancy per line ends up in an invoice.
  assert.equal(toPaise('1.005').code, 'price_sub_paisa')
})

test('string parsing never uses floating point', () => {
  // 179.99 via parseFloat * 100 is 17998.999999999996; the decimal path must give 17999.
  assert.deepEqual(toPaise('179.99'), { ok: true, paise: 17999 })
})

test('every accepted price is a safe integer', () => {
  for (const input of ['60', '60.5', '1,20,500.05', 75.5, 8.15]) {
    const result = toPaise(input)
    assert.ok(Number.isSafeInteger(result.paise), `${input} produced ${result.paise}`)
  }
})

test('formatPaise is display-only and round-trips', () => {
  assert.equal(formatPaise(6000), '₹60.00')
  assert.equal(formatPaise(6005), '₹60.05')
  assert.equal(formatPaise(5), '₹0.05')
})
