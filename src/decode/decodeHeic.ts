// Decoding HEIC/HEIF photos (what iPhones produce) in the browser.
//
// Safari decodes HEIC natively through createImageBitmap. Chrome and Firefox
// cannot, so for them we fall back to libheif compiled to WebAssembly, run in
// a worker (libheifClient.ts / heic.worker.ts). libheifClient.ts is imported
// statically, not through import(): a failed dynamic import cannot be retried
// without reloading the page. The worker script and the wasm stay lazy.

import { looksLikeHeic } from './looksLikeHeic';
import { decodeWithLibheif } from './libheifClient';
import { HeicDecodeError } from './heicMessages';

export { HeicDecodeError };

/**
 * Fewer bytes than this cannot be a HEIC/HEIF: the file must open with an
 * `ftyp` box, which alone takes 16 (size, 'ftyp', major brand, minor version).
 */
export const MIN_HEIC_BYTES = 16;

export interface DecodeHeicResult {
  /** The decoded image, ready to draw with drawImage() or feed to a canvas. */
  bitmap: ImageBitmap;
  width: number;
  height: number;
  /** Which path produced the result, mostly useful for diagnostics/tests. */
  decoder: 'native' | 'libheif-js';
  /** How many top-level images the container held (bursts, live photos, …). */
  imageCount: number;
}

/**
 * Decode a HEIC/HEIF file to pixels the page can draw.
 *
 * Orientation: HEIC files carry their rotation/mirroring as structural
 * `irot`/`imir` boxes rather than (only) EXIF, and both the native decoder
 * and libheif apply those themselves before handing back pixels — the
 * result here is already upright. (A file that relied solely on an EXIF
 * orientation tag, with no `irot`/`imir` box, is not corrected; iPhone HEICs
 * do not do this, but it is a known gap — see the module's test notes.)
 */
export async function decodeHeic(file: Blob): Promise<DecodeHeicResult> {
  if (!(await looksLikeHeic(file))) {
    throw new HeicDecodeError('not-heic', 'That file is not a HEIC/HEIF photo.');
  }
  // A name or type can say HEIC for an empty or truncated file; do not
  // download the decoder (a worker and a 1.4 MB wasm) for one.
  if (file.size < MIN_HEIC_BYTES) {
    throw new HeicDecodeError(
      'damaged',
      file.size === 0 ? 'That file could not be read as HEIC/HEIF — it is empty.' : 'That file could not be read as HEIC/HEIF — it is too short to be one.',
    );
  }

  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return { bitmap, width: bitmap.width, height: bitmap.height, decoder: 'native', imageCount: 1 };
  } catch {
    // Not every environment accepts the orientation option; try once more
    // plainly before concluding the browser truly cannot decode this file.
    try {
      const bitmap = await createImageBitmap(file);
      return { bitmap, width: bitmap.width, height: bitmap.height, decoder: 'native', imageCount: 1 };
    } catch {
      // Expected on Chrome/Firefox: fall through to the library below.
    }
  }

  let buffer: ArrayBuffer;
  try {
    buffer = await file.arrayBuffer();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new HeicDecodeError('damaged', `Could not read that file (${reason}).`);
  }

  const result = await decodeWithLibheif(buffer);
  return { bitmap: result.bitmap, width: result.width, height: result.height, decoder: 'libheif-js', imageCount: result.imageCount };
}
