import { describe, expect, it } from 'vitest';
import { lzwEncode } from '../../src/export/gif/lzw';
import { lzwDecode } from './gifDecoder';

/** Round-trips `indices` (values must be < 2^minCodeSize) through encode then an independent decode. */
function roundTrip(indices: Uint8Array, minCodeSize: number): Uint8Array {
  const compressed = lzwEncode(indices, minCodeSize);
  return lzwDecode(compressed, minCodeSize, indices.length);
}

describe('lzwEncode', () => {
  it('round-trips a short, varied sequence', () => {
    const indices = Uint8Array.from([0, 1, 2, 3, 0, 1, 2, 3, 0, 0, 1, 1, 2, 2, 3, 3]);
    expect(roundTrip(indices, 2)).toEqual(indices);
  });

  it('round-trips a single repeated value (one effective colour)', () => {
    const indices = new Uint8Array(500).fill(7);
    expect(roundTrip(indices, 4)).toEqual(indices);
  });

  it('round-trips a single pixel', () => {
    const indices = Uint8Array.from([3]);
    expect(roundTrip(indices, 2)).toEqual(indices);
  });

  it('round-trips an empty frame', () => {
    const indices = new Uint8Array(0);
    expect(roundTrip(indices, 2)).toEqual(indices);
  });

  it('round-trips more than 4096 distinct code sequences, forcing a dictionary reset', () => {
    // A de Bruijn-ish ramp: every pixel differs from a simple repeat, so the
    // dictionary keeps learning new sequences and must be reset at least
    // once past the 4096-code limit.
    const n = 20000;
    const indices = new Uint8Array(n);
    let state = 42;
    for (let i = 0; i < n; i++) {
      state = (state * 1103515245 + 12345) >>> 0;
      indices[i] = state & 0xff;
    }
    expect(roundTrip(indices, 8)).toEqual(indices);
  });

  it('grows code size as the dictionary fills, and a 8-bit palette starts at 9-bit codes', () => {
    // Not directly observable from lzwEncode's return value alone, but we
    // can at least confirm encoding+decoding a long run with many distinct
    // values (which forces code size growth past 9, 10, 11 and 12 bits)
    // still round-trips correctly.
    const n = 5000;
    const indices = new Uint8Array(n);
    for (let i = 0; i < n; i++) indices[i] = (i * 37) % 256;
    expect(roundTrip(indices, 8)).toEqual(indices);
  });
});
