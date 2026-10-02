// Recognising HEIC/HEIF files, even when the browser or OS got the MIME type
// or extension wrong (very common: iOS sometimes reports HEICs shared from
// Mail/Messages as application/octet-stream, and some Android file pickers
// report image/heic for things that are not).
//
// HEIC and AVIF are both ISO-BMFF ("MP4-family") containers that start with
// an `ftyp` box naming one or more four-character "brands". We read that box
// directly off the file's bytes so detection does not depend on what the
// browser decided the file's type was. AVIF is excluded on purpose: both
// Chrome and Firefox decode it natively, so routing it through the HEIC
// decoder would be wrong and wasteful.

/** Brands that identify a HEIC/HEIF image (not a sequence/video-only track). */
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);

/** Brands that identify AVIF, which browsers decode natively; never route these to the HEIC path. */
const AVIF_BRANDS = new Set(['avif', 'avis']);

const HEIC_MIME_TYPES = new Set([
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
]);

const HEIC_EXTENSIONS = /\.(heic|heif|hif)$/i;

/**
 * Read the ISO-BMFF `ftyp` box's brand list from the start of a file.
 * Returns an empty array if the file is not ISO-BMFF (no `ftyp` box at the
 * very start), which is the normal case for JPEG/PNG/etc.
 */
async function readFtypBrands(blob: Blob): Promise<string[]> {
  // The ftyp box is always the first box in a conforming HEIF/AVIF file, and
  // is small (a handful of four-byte brands); 512 bytes is generous headroom.
  const head = new Uint8Array(await blob.slice(0, 512).arrayBuffer());
  if (head.length < 16) return [];

  const readU32 = (offset: number) => (head[offset] << 24) | (head[offset + 1] << 16) | (head[offset + 2] << 8) | head[offset + 3];
  const readTag = (offset: number) => String.fromCharCode(head[offset], head[offset + 1], head[offset + 2], head[offset + 3]);

  const boxSize = readU32(0) >>> 0;
  if (readTag(4) !== 'ftyp') return [];

  // boxSize of 0 means "extends to end of file", which we don't support
  // reading further for (we only need the brands, which are near the start).
  const end = boxSize > 0 ? Math.min(boxSize, head.length) : head.length;

  const brands: string[] = [];
  // Layout: size(4) 'ftyp'(4) major_brand(4) minor_version(4) [compatible_brands(4)]*
  if (end >= 12) brands.push(readTag(8)); // major brand
  for (let offset = 16; offset + 4 <= end; offset += 4) {
    brands.push(readTag(offset));
  }
  return brands;
}

/**
 * Decide whether a file is a HEIC/HEIF image. Checks the file's actual
 * bytes (the `ftyp` box brands) first, since that is the one signal that
 * cannot lie; falls back to MIME type and file extension when the bytes
 * cannot be read as ISO-BMFF (e.g. the file is empty or truncated).
 */
export async function looksLikeHeic(file: Blob & { name?: string }): Promise<boolean> {
  try {
    const brands = await readFtypBrands(file);
    if (brands.length > 0) {
      // `mif1`/`msf1` are generic "still image" brands shared by HEIC and
      // AVIF, so an AVIF's compatible-brands list satisfies HEIC_BRANDS too.
      // Check for the AVIF-specific brands first and let them win: real
      // AVIF files always carry `avif`/`avis` somewhere in the list, and
      // browsers decode those natively, so this must never say HEIC.
      const hasAvif = brands.some((brand) => AVIF_BRANDS.has(brand));
      if (hasAvif) return false;
      const hasHeic = brands.some((brand) => HEIC_BRANDS.has(brand));
      if (hasHeic) return true;
      // A recognisable ISO-BMFF ftyp box, but with brands that are neither
      // HEIC nor AVIF (e.g. a plain MP4 video): trust that over a wrong
      // MIME type/extension, since we positively identified the container.
      return false;
    }
  } catch {
    // Fall through to MIME/extension heuristics below (e.g. in environments
    // where Blob#slice/#arrayBuffer is unavailable or the read failed).
  }

  if (file.type) return HEIC_MIME_TYPES.has(file.type.toLowerCase());
  const name = file.name ?? '';
  return HEIC_EXTENSIONS.test(name);
}
