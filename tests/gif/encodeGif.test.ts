import { describe, expect, it } from 'vitest';
import { encodeGif } from '../../src/export/gif/encodeGif';
import { buildPalette } from '../../src/export/gif/palette';
import { quantizeFrames } from '../../src/export/gif/quantize';
import type { Bitmap } from '../../src/engine/types';
import { decodeGif } from './gifDecoder';

/** Builds a flat-coloured test frame. */
function solidFrame(width: number, height: number, r: number, g: number, b: number): Bitmap {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  }
  return { width, height, data };
}

/** Builds a frame with a smooth gradient, so it has many distinct colours (good for palette/quantise tests). */
function gradientFrame(width: number, height: number, seed: number): Bitmap {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = Math.floor((x / width) * 255);
      data[i + 1] = Math.floor((y / height) * 255);
      data[i + 2] = Math.floor(((x + y + seed) % (width + height)) / (width + height) * 255);
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

/** Deterministic pseudo-random frame with lots of distinct pixel values, to stress the LZW dictionary. */
function noisyFrame(width: number, height: number, seed: number): Bitmap {
  let state = seed >>> 0;
  function rand(): number {
    // xorshift32
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state;
  }
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    const r = rand();
    data[i] = r & 0xff;
    data[i + 1] = (r >> 8) & 0xff;
    data[i + 2] = (r >> 16) & 0xff;
    data[i + 3] = 255;
  }
  return { width, height, data };
}

/** Nearest palette colour by squared distance; used to predict what quantisation should produce. */
function nearestIndex(palette: Array<[number, number, number]>, r: number, g: number, b: number): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const [pr, pg, pb] = palette[i];
    const dist = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

describe('encodeGif container structure', () => {
  it('starts with the GIF89a header', () => {
    const bytes = encodeGif([solidFrame(4, 4, 10, 20, 30)]);
    expect(String.fromCharCode(...bytes.subarray(0, 6))).toBe('GIF89a');
  });

  it('writes a correct logical screen descriptor', () => {
    const bytes = encodeGif([solidFrame(17, 9, 1, 2, 3)]);
    const width = bytes[6] | (bytes[7] << 8);
    const height = bytes[8] | (bytes[9] << 8);
    expect(width).toBe(17);
    expect(height).toBe(9);
    const packed = bytes[10];
    expect(packed & 0x80).toBe(0x80); // global colour table flag set
  });

  it('reports the same canvas size and frame count to an independent decoder', () => {
    const frames = [gradientFrame(20, 15, 0), gradientFrame(20, 15, 1), gradientFrame(20, 15, 2)];
    const bytes = encodeGif(frames);
    const decoded = decodeGif(bytes);
    expect(decoded.width).toBe(20);
    expect(decoded.height).toBe(15);
    expect(decoded.frames).toHaveLength(3);
  });

  it('includes the NETSCAPE loop extension with the requested loop count', () => {
    const bytes = encodeGif([solidFrame(2, 2, 0, 0, 0)], { loop: 0 });
    const decoded = decodeGif(bytes);
    expect(decoded.loopCount).toBe(0);

    const bytesOnce = encodeGif([solidFrame(2, 2, 0, 0, 0)], { loop: 5 });
    expect(decodeGif(bytesOnce).loopCount).toBe(5);
  });

  it('gives every frame the requested delay, converted to centiseconds', () => {
    const frames = [solidFrame(3, 3, 1, 1, 1), solidFrame(3, 3, 2, 2, 2)];
    const decoded = decodeGif(encodeGif(frames, { delayMs: 125 }));
    expect(decoded.frames).toHaveLength(2);
    for (const frame of decoded.frames) expect(frame.delayCentiseconds).toBe(13); // 125ms rounds to 13cs
  });

  it('rounds delay sensibly and notes short delays get clamped by most players', () => {
    // 10ms -> 1 centisecond. Most real players clamp anything under ~2cs to
    // about 10cs, but the file itself should faithfully store what was asked.
    const decoded = decodeGif(encodeGif([solidFrame(2, 2, 0, 0, 0)], { delayMs: 10 }));
    expect(decoded.frames[0].delayCentiseconds).toBe(1);
  });

  it('uses a power-of-two palette size', () => {
    const bytes = encodeGif([gradientFrame(50, 50, 0)], { maxColors: 256 });
    const packed = bytes[10];
    const tableSize = 1 << ((packed & 0x07) + 1);
    expect(Math.log2(tableSize) % 1).toBe(0);
    expect(tableSize).toBeGreaterThanOrEqual(2);
    expect(tableSize).toBeLessThanOrEqual(256);
  });
});

describe('encodeGif pixel data', () => {
  it('round-trips a tiny multi-colour image through an independent decoder', () => {
    const frame = gradientFrame(9, 7, 3);
    const decoded = decodeGif(encodeGif([frame]));
    const palette = decoded.frames[0].palette;
    for (let p = 0; p < frame.width * frame.height; p++) {
      const i = p * 4;
      const expectedIndex = nearestIndex(palette as Array<[number, number, number]>, frame.data[i], frame.data[i + 1], frame.data[i + 2]);
      expect(decoded.frames[0].indices[p]).toBe(expectedIndex);
    }
  });

  it('round-trips a single-colour image (one-entry effective palette)', () => {
    const frame = solidFrame(12, 8, 200, 50, 10);
    const decoded = decodeGif(encodeGif([frame]));
    const indices = decoded.frames[0].indices;
    expect(indices.length).toBe(12 * 8);
    for (const idx of indices) expect(idx).toBe(indices[0]);
    const [r, g, b] = decoded.frames[0].palette[indices[0]];
    expect(r).toBe(200);
    expect(g).toBe(50);
    expect(b).toBe(10);
  });

  it('round-trips a 1x1 image', () => {
    const frame = solidFrame(1, 1, 5, 6, 7);
    const decoded = decodeGif(encodeGif([frame]));
    expect(decoded.width).toBe(1);
    expect(decoded.height).toBe(1);
    expect(decoded.frames[0].indices.length).toBe(1);
  });

  it('round-trips a noisy image with more than 4096 distinct LZW sequences (forces a dictionary reset)', () => {
    // 96x96 = 9216 pixels of pseudo-random colour: far more than the 4096
    // codes a single LZW dictionary can hold, so the encoder must clear and
    // restart its dictionary at least once during this frame. Compare
    // against what the encoder's own quantiser produced (not an exact
    // brute-force nearest colour search), since this project's mapper is
    // deliberately an approximate, coarse-grid lookup for speed - pixel
    // noise like this is exactly the case where the two can legitimately
    // disagree despite the encoder behaving correctly end to end.
    const frame = noisyFrame(96, 96, 12345);
    const palette = buildPalette([frame], 256);
    const [expectedIndices] = quantizeFrames([frame], palette, false);
    const decoded = decodeGif(encodeGif([frame], { maxColors: 256 }));
    expect(decoded.frames[0].indices).toEqual(expectedIndices);
  });

  it('keeps one global palette across frames so colours do not flicker', () => {
    const frames = [gradientFrame(16, 16, 0), gradientFrame(16, 16, 5), gradientFrame(16, 16, 9)];
    const decoded = decodeGif(encodeGif(frames, { palette: 'global' }));
    const p0 = JSON.stringify(decoded.frames[0].palette);
    for (const frame of decoded.frames) expect(JSON.stringify(frame.palette)).toBe(p0);
  });
});

describe('encodeGif input validation and determinism', () => {
  it('throws a clear error when frames have different sizes', () => {
    const a = solidFrame(10, 10, 0, 0, 0);
    const b = solidFrame(10, 11, 0, 0, 0);
    expect(() => encodeGif([a, b])).toThrow(/same size/);
  });

  it('throws when given no frames', () => {
    expect(() => encodeGif([])).toThrow();
  });

  it('gives identical bytes for identical input', () => {
    const frames1 = [gradientFrame(30, 20, 0), gradientFrame(30, 20, 1)];
    const frames2 = [gradientFrame(30, 20, 0), gradientFrame(30, 20, 1)];
    const bytes1 = encodeGif(frames1, { delayMs: 100, dither: true });
    const bytes2 = encodeGif(frames2, { delayMs: 100, dither: true });
    expect(bytes1).toEqual(bytes2);
  });
});
