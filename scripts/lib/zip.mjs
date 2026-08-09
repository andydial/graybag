/**
 * A minimal ZIP reader — enough to pull one named entry out of an APK.
 *
 * An APK is a ZIP, and the file we want out of it (`AndroidManifest.xml`) is a few kilobytes
 * inside a forty-megabyte archive. Node ships `zlib` but no archive reader, so this walks the
 * central directory itself rather than adding a dependency to the payment build-integrity
 * path. Roughly seventy lines, a stable 1989 format, and no supply chain.
 *
 * Deliberately not general: no ZIP64, no encryption, no streaming. APKs produced by the
 * Android Gradle Plugin are well-formed, single-disk, and far below the 4 GB at which ZIP64
 * becomes necessary. Anything outside that throws rather than guesses.
 */
import { inflateRawSync } from 'node:zlib'

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50

const STORED = 0
const DEFLATED = 8

/**
 * Locate the End Of Central Directory record. It sits at the very end of the file unless
 * there is a ZIP comment, so scan backwards over the largest comment the format allows.
 */
function findEndOfCentralDirectory(buf) {
  const maxCommentLength = 0xffff
  const start = Math.max(0, buf.length - maxCommentLength - 22)
  for (let i = buf.length - 22; i >= start; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) return i
  }
  throw new Error('Not a ZIP archive: no end-of-central-directory record found')
}

/**
 * List every entry in the archive as `{ name, offset, compressionMethod, compressedSize,
 * uncompressedSize }`, read from the central directory.
 */
export function listEntries(buf) {
  const eocd = findEndOfCentralDirectory(buf)
  const entryCount = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)

  const entries = []
  for (let i = 0; i < entryCount; i++) {
    if (buf.readUInt32LE(p) !== CENTRAL_SIGNATURE) {
      throw new Error(`Corrupt central directory at byte ${p} (entry ${i} of ${entryCount})`)
    }
    const compressionMethod = buf.readUInt16LE(p + 10)
    const compressedSize = buf.readUInt32LE(p + 20)
    const uncompressedSize = buf.readUInt32LE(p + 24)
    const nameLength = buf.readUInt16LE(p + 28)
    const extraLength = buf.readUInt16LE(p + 30)
    const commentLength = buf.readUInt16LE(p + 32)
    const offset = buf.readUInt32LE(p + 42)
    const name = buf.subarray(p + 46, p + 46 + nameLength).toString('utf8')

    entries.push({ name, offset, compressionMethod, compressedSize, uncompressedSize })
    p += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

/**
 * Read one entry by exact name. Returns its decompressed bytes, or `null` if the archive
 * does not contain it.
 */
export function readEntry(buf, entryName) {
  const entry = listEntries(buf).find((e) => e.name === entryName)
  if (!entry) return null

  if (buf.readUInt32LE(entry.offset) !== LOCAL_SIGNATURE) {
    throw new Error(`Corrupt local header for "${entryName}" at byte ${entry.offset}`)
  }
  // The local header's name and extra lengths are authoritative and can differ from the
  // central directory's, so the data offset must be computed from the local header.
  const nameLength = buf.readUInt16LE(entry.offset + 26)
  const extraLength = buf.readUInt16LE(entry.offset + 28)
  const dataStart = entry.offset + 30 + nameLength + extraLength
  const raw = buf.subarray(dataStart, dataStart + entry.compressedSize)

  if (entry.compressionMethod === STORED) return Buffer.from(raw)
  if (entry.compressionMethod === DEFLATED) return inflateRawSync(raw)
  throw new Error(
    `"${entryName}" uses unsupported compression method ${entry.compressionMethod}`,
  )
}
