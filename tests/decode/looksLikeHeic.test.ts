import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { looksLikeHeic } from '../../src/decode/looksLikeHeic';

const fixture = (name: string) => new Blob([readFileSync(new URL(`../fixtures/${name}`, import.meta.url))]);

describe('looksLikeHeic: real file headers', () => {
  it('recognises a real HEIC (brand heic/mif1) regardless of name or MIME type', async () => {
    await expect(looksLikeHeic(fixture('mona-lisa-256.heic'))).resolves.toBe(true);
  });

  it('recognises a HEIC with a non-zero irot transform the same way', async () => {
    await expect(looksLikeHeic(fixture('mona-lisa-256-irot90.heic'))).resolves.toBe(true);
  });

  it('does not misroute an AVIF (brand avif/mif1) to the HEIC path', async () => {
    await expect(looksLikeHeic(fixture('mona-lisa-256.avif'))).resolves.toBe(false);
  });

  it('recognises a HEIC even with the wrong MIME type and extension', async () => {
    const bytes = readFileSync(new URL('../fixtures/mona-lisa-256.heic', import.meta.url));
    const file = new File([bytes], 'photo.jpg', { type: 'image/jpeg' });
    await expect(looksLikeHeic(file)).resolves.toBe(true);
  });

  it('trusts the MIME type over a renamed extension when the bytes are not ISO-BMFF', async () => {
    // A JPEG's bytes have no `ftyp` box to read, so detection falls back to
    // MIME type/extension. When the browser reports the real type (e.g. a
    // picker that sniffs content), that correctly wins over the extension.
    const bytes = readFileSync(new URL('../fixtures/mona-lisa-256-jpeg-renamed.heic', import.meta.url));
    const file = new File([bytes], 'mona-lisa-256-jpeg-renamed.heic', { type: 'image/jpeg' });
    await expect(looksLikeHeic(file)).resolves.toBe(false);
  });

  it('documents the inherent limitation: an unreadable-as-ISO-BMFF file with no MIME type is judged by extension alone', async () => {
    // This is the "JPEG renamed to .heic, with no MIME type" case: the file
    // is not valid ISO-BMFF, so we cannot see through the renamed extension.
    // decodeHeic's upfront looksLikeHeic() check will therefore say "yes",
    // and the actual decode step is what then has to behave sensibly (see
    // the headless-browser notes in the report for what was and wasn't run).
    const bytes = readFileSync(new URL('../fixtures/mona-lisa-256-jpeg-renamed.heic', import.meta.url));
    const file = new File([bytes], 'mona-lisa-256-jpeg-renamed.heic', { type: '' });
    await expect(looksLikeHeic(file)).resolves.toBe(true);
  });

  it('rejects a real PNG', async () => {
    await expect(looksLikeHeic(fixture('mona-lisa-256.png'))).resolves.toBe(false);
  });

  it('falls back to MIME type for a truncated/corrupt file with no readable ftyp box', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'broken.heic', { type: 'image/heic' });
    await expect(looksLikeHeic(file)).resolves.toBe(true);
  });

  it('falls back to extension for an empty file with no type set', async () => {
    const file = new File([], 'empty.heic', { type: '' });
    await expect(looksLikeHeic(file)).resolves.toBe(true);
  });

  it('treats an empty file with no name/type hint as not HEIC', async () => {
    const file = new File([], '', { type: '' });
    await expect(looksLikeHeic(file)).resolves.toBe(false);
  });

  it('a short but genuinely truncated HEIC (box size known, bytes cut) still reads its partial brand list', async () => {
    await expect(looksLikeHeic(fixture('mona-lisa-256-corrupt.heic'))).resolves.toBe(true);
  });
});
