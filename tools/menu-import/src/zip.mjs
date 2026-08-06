// Minimal ZIP reader and writer.
//
// An .xlsx file is a ZIP archive of XML parts. This repo has no node_modules and the
// importer must run with `node` alone (see tools/menu-import/README.md §"Why no
// dependencies"), so the handful of ZIP features Excel actually emits are implemented
// here rather than pulled in.
//
// Supported: stored (method 0) and deflate (method 8), no encryption, no ZIP64.
// Anything else throws with a message naming what was found.

import { inflateRawSync, deflateRawSync } from 'node:zlib'

const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_EOCD = 0x06054b50

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c
  }
  return table
})()

export function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

/**
 * Read a ZIP archive into a Map of entry name -> Buffer.
 * @param {Buffer} buf
 * @returns {Map<string, Buffer>}
 */
export function readZip(buf) {
  const eocd = findEocd(buf)
  const entryCount = buf.readUInt16LE(eocd + 10)
  let offset = buf.readUInt32LE(eocd + 16)

  const entries = new Map()
  for (let i = 0; i < entryCount; i++) {
    if (buf.readUInt32LE(offset) !== SIG_CENTRAL) {
      throw new Error(`zip: central directory entry ${i} has a bad signature`)
    }
    const method = buf.readUInt16LE(offset + 10)
    const compressedSize = buf.readUInt32LE(offset + 20)
    const uncompressedSize = buf.readUInt32LE(offset + 24)
    const nameLen = buf.readUInt16LE(offset + 28)
    const extraLen = buf.readUInt16LE(offset + 30)
    const commentLen = buf.readUInt16LE(offset + 32)
    const localOffset = buf.readUInt32LE(offset + 42)
    const name = buf.toString('utf8', offset + 46, offset + 46 + nameLen)

    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new Error(`zip: "${name}" needs ZIP64, which this reader does not implement`)
    }

    entries.set(name, readLocalEntry(buf, localOffset, method, compressedSize, name))
    offset += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

function readLocalEntry(buf, localOffset, method, compressedSize, name) {
  if (buf.readUInt32LE(localOffset) !== SIG_LOCAL) {
    throw new Error(`zip: "${name}" has a bad local header signature`)
  }
  const flags = buf.readUInt16LE(localOffset + 6)
  if (flags & 0x1) throw new Error(`zip: "${name}" is encrypted`)
  const nameLen = buf.readUInt16LE(localOffset + 26)
  const extraLen = buf.readUInt16LE(localOffset + 28)
  const start = localOffset + 30 + nameLen + extraLen
  const raw = buf.subarray(start, start + compressedSize)

  if (method === 0) return Buffer.from(raw)
  if (method === 8) return inflateRawSync(raw)
  throw new Error(`zip: "${name}" uses compression method ${method}, which is not supported`)
}

function findEocd(buf) {
  if (buf.length < 22) throw new Error('zip: too short to be a ZIP archive')
  // The EOCD is at the end, but a trailing comment may push it back up to 64KB.
  const earliest = Math.max(0, buf.length - 22 - 0xffff)
  for (let i = buf.length - 22; i >= earliest; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i
  }
  throw new Error('zip: no end-of-central-directory record — not a ZIP archive')
}

/**
 * Write a ZIP archive. Timestamps are fixed at 1980-01-01 so the same input always
 * produces byte-identical output, which is what lets fixture workbooks be compared.
 * @param {Array<{name: string, data: Buffer|string}>} files
 * @returns {Buffer}
 */
export function writeZip(files) {
  const DOS_DATE = 0x0021 // 1980-01-01
  const local = []
  const central = []
  let offset = 0

  for (const file of files) {
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, 'utf8')
    const compressed = deflateRawSync(data, { level: 9 })
    const nameBuf = Buffer.from(file.name, 'utf8')
    const sum = crc32(data)

    const header = Buffer.alloc(30)
    header.writeUInt32LE(SIG_LOCAL, 0)
    header.writeUInt16LE(20, 4) // version needed
    header.writeUInt16LE(0, 6) // flags
    header.writeUInt16LE(8, 8) // deflate
    header.writeUInt16LE(0, 10) // time
    header.writeUInt16LE(DOS_DATE, 12)
    header.writeUInt32LE(sum, 14)
    header.writeUInt32LE(compressed.length, 18)
    header.writeUInt32LE(data.length, 22)
    header.writeUInt16LE(nameBuf.length, 26)
    header.writeUInt16LE(0, 28)
    local.push(header, nameBuf, compressed)

    const dir = Buffer.alloc(46)
    dir.writeUInt32LE(SIG_CENTRAL, 0)
    dir.writeUInt16LE(20, 4) // version made by
    dir.writeUInt16LE(20, 6) // version needed
    dir.writeUInt16LE(0, 8)
    dir.writeUInt16LE(8, 10)
    dir.writeUInt16LE(0, 12)
    dir.writeUInt16LE(DOS_DATE, 14)
    dir.writeUInt32LE(sum, 16)
    dir.writeUInt32LE(compressed.length, 20)
    dir.writeUInt32LE(data.length, 24)
    dir.writeUInt16LE(nameBuf.length, 28)
    dir.writeUInt16LE(0, 30) // extra
    dir.writeUInt16LE(0, 32) // comment
    dir.writeUInt16LE(0, 34) // disk
    dir.writeUInt16LE(0, 36) // internal attrs
    dir.writeUInt32LE(0, 38) // external attrs
    dir.writeUInt32LE(offset, 42)
    central.push(dir, nameBuf)

    offset += header.length + nameBuf.length + compressed.length
  }

  const centralBuf = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(SIG_EOCD, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([...local, centralBuf, eocd])
}
