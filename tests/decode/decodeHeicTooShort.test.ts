// An empty or truncated "HEIC" must be turned away before the decoder (a
// worker plus a 1.4 MB wasm) is downloaded for it.

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { decodeWithLibheif } = vi.hoisted(() => ({ decodeWithLibheif: vi.fn() }));
vi.mock('../../src/decode/libheifClient', () => ({ decodeWithLibheif }));

const { decodeHeic, MIN_HEIC_BYTES } = await import('../../src/decode/decodeHeic');
const { skipReason } = await import('../../src/ui/photos/skipReason');

const heicBytes = readFileSync(new URL('../fixtures/mona-lisa-256.heic', import.meta.url));

/** What loadImage.ts makes of a failure, and what the visitor is then told. */
async function visitorReason(file: Blob): Promise<string> {
  try {
    await decodeHeic(file);
  } catch (error) {
    return skipReason(new Error(`HEIC: ${(error as Error).message}`));
  }
  throw new Error('expected decodeHeic to fail');
}

describe('decodeHeic: files too short to be HEIC', () => {
  const createImageBitmap = vi.fn(() => Promise.reject(new Error('cannot decode')));
  beforeEach(() => {
    decodeWithLibheif.mockReset();
    decodeWithLibheif.mockRejectedValue(new Error('decoder not available in tests'));
    createImageBitmap.mockClear();
    vi.stubGlobal('createImageBitmap', createImageBitmap);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('rejects an empty .heic as damaged without touching any decoder', async () => {
    const file = new File([], 'empty.heic', { type: '' });
    await expect(decodeHeic(file)).rejects.toMatchObject({ name: 'HeicDecodeError', kind: 'damaged' });
    expect(decodeWithLibheif).not.toHaveBeenCalled();
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it('rejects the empty fixture the same way', async () => {
    const file = new File([readFileSync(new URL('../fixtures/empty.heic', import.meta.url))], 'empty.heic');
    await expect(decodeHeic(file)).rejects.toMatchObject({ kind: 'damaged' });
    expect(decodeWithLibheif).not.toHaveBeenCalled();
  });

  it('rejects a file cut off inside its ftyp box, even with a HEIC type', async () => {
    const file = new File([heicBytes.subarray(0, MIN_HEIC_BYTES - 1)], 'cut.heic', { type: 'image/heic' });
    await expect(decodeHeic(file)).rejects.toMatchObject({ kind: 'damaged' });
    expect(decodeWithLibheif).not.toHaveBeenCalled();
  });

  it('tells the visitor the same as for any other damaged HEIC', async () => {
    expect(await visitorReason(new File([], 'empty.heic'))).toBe('a damaged HEIC photo');
    expect(await visitorReason(new File([heicBytes.subarray(0, 8)], 'cut.heic'))).toBe('a damaged HEIC photo');
  });

  it('still hands a file of the minimum length on to the decoder', async () => {
    const file = new File([heicBytes.subarray(0, MIN_HEIC_BYTES)], 'short.heic');
    await expect(decodeHeic(file)).rejects.toThrow('decoder not available in tests');
    expect(decodeWithLibheif).toHaveBeenCalledTimes(1);
  });

  it('still says not-heic for an empty file with nothing HEIC about it', async () => {
    await expect(decodeHeic(new File([], 'notes.txt', { type: 'text/plain' }))).rejects.toMatchObject({ kind: 'not-heic' });
  });
});
