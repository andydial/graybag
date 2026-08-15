/**
 * Preparing a dish photo in the browser before it is uploaded — `E10-24`.
 *
 * The audience is private schools in tier-1 Indian cities on mid-range Androids over unreliable
 * connections, and CLAUDE.md's performance priorities name **correctly sized images** explicitly.
 * A 4 MB phone photo on a menu is the single easiest way to make that menu unusable, and no amount
 * of caching downstream fixes an image that was the wrong size when it was stored.
 *
 * So the resize happens here, before the bytes ever leave the machine: it costs one canvas draw,
 * it means the upload is a tenth of the size on the operator's own connection too, and the Edge
 * Function's 3 MB ceiling becomes something no ordinary photo can hit.
 *
 * WebP where the browser will encode it, JPEG otherwise. Both are decided by asking the canvas
 * what it produced rather than by trusting the request — `toBlob` silently falls back to PNG when
 * it does not know a type, and a PNG photograph is several times larger than the JPEG it replaced.
 */

/** Long edge, in pixels. A dish card is never rendered wider than this, even on a tablet at 2×. */
export const MAX_EDGE = 1280;

/** Quality for the lossy encoders. 0.82 is where artefacts stop being visible on food photography. */
const QUALITY = 0.82;

export interface PreparedImage {
  dataBase64: string;
  contentType: string;
  width: number;
  height: number;
  bytes: number;
}

const toBase64 = (buffer: ArrayBuffer): string => {
  const view = new Uint8Array(buffer);
  let binary = '';
  // Chunked, because `String.fromCharCode(...bigArray)` blows the argument limit somewhere around
  // a hundred thousand bytes and fails on exactly the large photos this function exists for.
  const CHUNK = 0x8000;
  for (let i = 0; i < view.length; i += CHUNK) {
    binary += String.fromCharCode(...view.subarray(i, i + CHUNK));
  }
  return btoa(binary);
};

/**
 * @throws if the file is not an image the browser can decode — a `.heic` from an iPhone being the
 *   realistic case, and one worth failing loudly on rather than uploading something unopenable.
 */
export async function prepareDishImage(file: File): Promise<PreparedImage> {
  if (!file.type.startsWith('image/')) {
    throw new Error(`${file.name} is not an image.`);
  }

  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error(
      `${file.name} could not be opened. HEIC photos from an iPhone need converting to JPEG first.`,
    );
  });

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot resize images.');
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/webp', QUALITY);
  });

  // `toBlob` returns PNG when it does not support the requested type, so the answer is read from
  // the blob rather than assumed. A PNG photograph is several times the size of the JPEG it
  // replaced, which would defeat the entire point of resizing.
  let chosen = blob;
  if (!chosen || chosen.type !== 'image/webp') {
    chosen = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/jpeg', QUALITY);
    });
  }
  if (!chosen) throw new Error('The image could not be re-encoded.');

  return {
    dataBase64: toBase64(await chosen.arrayBuffer()),
    contentType: chosen.type === 'image/webp' ? 'image/webp' : 'image/jpeg',
    width,
    height,
    bytes: chosen.size,
  };
}
