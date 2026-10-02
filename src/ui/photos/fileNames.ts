// File names for exports: each photo's results are named after its original
// file, made safe for any computer and unique among the loaded photos.
//
// Letters, digits, spaces, emoji and ordinary punctuation from any language
// are kept; only what is unsafe somewhere is replaced: path separators,
// control and invisible formatting characters, the characters Windows forbids,
// "..", leading or trailing dots and spaces, and Windows device names such as
// "CON". The zip writer marks names as UTF-8, so non-Latin names survive.

/** Longest stem kept, in UTF-8 bytes, so whole names stay short (file systems allow 255). */
const MAX_STEM_BYTES = 64;

/** Stem for a photo whose name has nothing usable in it ("....", "?", ""). */
const FALLBACK_STEM = 'untitled';

/**
 * Characters to replace: control, invisible formatting, unassigned and
 * private-use characters (Unicode category C, except the zero-width joiner
 * that holds emoji like 👩‍💻 together), line and paragraph separators, and
 * the characters Windows forbids in names.
 */
const UNSAFE = /(?:(?!‍)[\p{C}\p{Zl}\p{Zp}<>:"/\\|?*])+/gu;

/** Windows device names, which are reserved even with an extension ("CON.tar.gz"). */
const DEVICE_NAME = /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])\s*(?:\.|$)/iu;

const encoder = new TextEncoder();

/**
 * A safe file-name stem from an original name, or "" if nothing usable is
 * left: no extension, NFC, unsafe characters replaced by "-", at most 64
 * UTF-8 bytes (cut between whole characters). Case is kept.
 *   "Été à Paris (2).JPG"     ->  "Été à Paris (2)"
 *   "../../etc/passwd.png"    ->  "etc-passwd"
 *   "日本語.jpg"               ->  "日本語"
 */
export function safeStem(name: string): string {
  let stem = name
    .normalize('NFC')
    .replace(/\.[A-Za-z0-9]{1,5}$/, '') // the extension
    .replace(/\s+/gu, ' ') // tabs, new lines and runs of spaces become one space
    .replace(UNSAFE, '-')
    .replace(/\.{2,}/g, '.'); // no ".."
  stem = trimEnds(stem);
  stem = trimEnds(cutToBytes(stem, MAX_STEM_BYTES));
  if (DEVICE_NAME.test(stem)) stem = `_${stem}`;
  return stem;
}

/** Remove leading and trailing dots, spaces and dashes. */
function trimEnds(stem: string): string {
  return stem.replace(/^[.\s-]+|[.\s-]+$/gu, '');
}

/** The longest start of `text` that fits in `maxBytes` of UTF-8, cut between whole characters. */
function cutToBytes(text: string, maxBytes: number): string {
  if (encoder.encode(text).length <= maxBytes) return text;
  let kept = '';
  let bytes = 0;
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
    bytes += encoder.encode(segment).length;
    if (bytes > maxBytes) break;
    kept += segment;
  }
  return kept;
}

/** Names that one computer or another treats as the same file ("A" and "a", "ß" and "SS"). */
function sameFileKey(stem: string): string {
  return stem.toUpperCase().toLowerCase();
}

/**
 * One unique export stem per original name, in order, ignoring case.
 *
 * - The first photo with a given stem keeps it exactly; repeats get " (2)",
 *   " (3)", ... like copies in a file manager.
 * - A suffix is never a stem some other photo has by itself, so a name in the
 *   zip that looks like an original file always comes from that file:
 *   ["photo", "photo (2)", "photo"] -> ["photo", "photo (2)", "photo (3)"].
 * - Names with nothing usable become "untitled", "untitled (2)", ... and never
 *   take a name from a photo that is really called "untitled".
 */
export function exportStems(names: readonly string[]): string[] {
  const stems = names.map(safeStem);
  const used = new Set(stems.filter((stem) => stem !== '').map(sameFileKey));
  const given = new Set<string>();

  function withSuffix(stem: string): string {
    for (let n = 2; ; n++) {
      const candidate = `${stem} (${n})`;
      if (!used.has(sameFileKey(candidate))) return candidate;
    }
  }

  // Real names first, so a fallback never takes a real photo's name.
  const result = stems.map((stem) => {
    if (stem === '') return '';
    const key = sameFileKey(stem);
    const unique = given.has(key) ? withSuffix(stem) : stem;
    given.add(key);
    used.add(sameFileKey(unique));
    return unique;
  });
  return result.map((stem) => {
    if (stem !== '') return stem;
    const unique = used.has(sameFileKey(FALLBACK_STEM)) ? withSuffix(FALLBACK_STEM) : FALLBACK_STEM;
    used.add(sameFileKey(unique));
    return unique;
  });
}

/** e.g. "Mona Lisa-polygons-seed-1.svg". */
export function exportEntryName(stem: string, style: string, seed: number, extension: string): string {
  return `${stem}-${style}-seed-${seed}.${extension}`;
}
