import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readZip, writeZip, crc32 } from '../src/zip.mjs'

test('crc32 matches the known value for "123456789"', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926)
})

test('round-trips entries through write and read', () => {
  const zip = writeZip([
    { name: 'a.txt', data: 'hello' },
    { name: 'nested/b.xml', data: '<x>ünïcøde ₹</x>' },
  ])
  const entries = readZip(zip)
  assert.deepEqual([...entries.keys()], ['a.txt', 'nested/b.xml'])
  assert.equal(entries.get('a.txt').toString('utf8'), 'hello')
  assert.equal(entries.get('nested/b.xml').toString('utf8'), '<x>ünïcøde ₹</x>')
})

test('round-trips a payload larger than one deflate block', () => {
  const big = Buffer.from('menu item,'.repeat(20_000))
  const entries = readZip(writeZip([{ name: 'big.csv', data: big }]))
  assert.equal(entries.get('big.csv').length, big.length)
  assert.ok(entries.get('big.csv').equals(big))
})

test('writing is deterministic — no embedded timestamp', () => {
  const first = writeZip([{ name: 'a.txt', data: 'hello' }])
  const second = writeZip([{ name: 'a.txt', data: 'hello' }])
  assert.ok(first.equals(second))
})

test('rejects something that is not a ZIP', () => {
  assert.throws(() => readZip(Buffer.from('this is a CSV, not a workbook')), /not a ZIP archive/)
})
