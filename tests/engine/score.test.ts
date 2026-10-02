import { describe, expect, it } from 'vitest';
import type { Bitmap, RGB } from '../../src/engine/types';
import { SHAPE_TYPES } from '../../src/engine/types';
import { computeColor } from '../../src/engine/color';
import { createPicture, paint } from '../../src/engine/picture';
import { fullTotal, totalAfterShape, totalToScore } from '../../src/engine/score';
import { createScanlines } from '../../src/engine/scanlines';
import { createShapeContext, randomShape, rasterizeShape } from '../../src/engine/shapes';
import { createRng } from '../../src/engine/rng';

function solidBitmap(width: number, height: number, pixels: RGB[]): Bitmap {
  const data = new Uint8ClampedArray(width * height * 4);
  pixels.forEach((p, i) => data.set([p[0], p[1], p[2], 255], i * 4));
  return { width, height, data };
}

function noiseBitmap(width: number, height: number, seed: number): Bitmap {
  const rng = createRng(seed);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i++) data[i] = rng.int(0, 255); // alpha random too
  return { width, height, data };
}

describe('best colour', () => {
  it('matches a hand-worked case', () => {
    // Two pixels, current colour 100 everywhere, targets 110 and 130 in red.
    // At opacity 51/255 = 0.2:  c = mean(d) + (mean(t) - mean(d)) / 0.2 = 100 + 20 * 5 = 200.
    // Check: 0.2 * 200 + 0.8 * 100 = 120 = mean target.
    const target = solidBitmap(2, 1, [
      [110, 60, 100],
      [130, 80, 100],
    ]);
    const picture = createPicture(target, [100, 100, 100]);
    const lines = createScanlines(1);
    rasterizeShape({ type: 'rectangle', x1: 0, y1: 0, x2: 2, y2: 1 }, lines, 2, 1);
    // Green: mean target 70 -> 100 + (-30) * 5 = -50, clamped to 0. Blue: unchanged at 100.
    expect(computeColor(picture, lines, 51)).toEqual([200, 0, 100]);
    // Fully opaque: the best colour is just the mean of the target.
    expect(computeColor(picture, lines, 255)).toEqual([120, 70, 100]);
  });
});

describe('score', () => {
  it('is 0 for a perfect match and 1 for black against white', () => {
    const white = solidBitmap(2, 2, [
      [255, 255, 255],
      [255, 255, 255],
      [255, 255, 255],
      [255, 255, 255],
    ]);
    expect(totalToScore(createPicture(white, [255, 255, 255]).total, 2, 2)).toBe(0);
    expect(totalToScore(createPicture(white, [0, 0, 0]).total, 2, 2)).toBe(1);
  });

  it('ignores the alpha channel of the target', () => {
    const target = noiseBitmap(5, 5, 1);
    const picture = createPicture(target, [10, 20, 30]);
    const opaque = { ...target, data: new Uint8ClampedArray(target.data) };
    for (let i = 3; i < opaque.data.length; i += 4) opaque.data[i] = 255;
    expect(createPicture(opaque, [10, 20, 30]).total).toBe(picture.total);
  });

  it('differential score equals a full rescore after painting', () => {
    const width = 50;
    const height = 40;
    const ctx = createShapeContext(width, height);
    const rng = createRng(99);
    const picture = createPicture(noiseBitmap(width, height, 2), [128, 64, 200]);
    const lines = createScanlines(height);
    for (let i = 0; i < 200; i++) {
      const type = SHAPE_TYPES[i % SHAPE_TYPES.length];
      const shape = randomShape(type, { ...ctx, unit: 1 }, rng, rng.range(0, width), rng.range(0, height));
      const alpha = rng.int(1, 255);
      rasterizeShape(shape, lines, width, height);
      const color = computeColor(picture, lines, alpha);
      const predicted = totalAfterShape(picture, lines, color, alpha);
      paint(picture, lines, color, alpha);
      expect(picture.total).toBe(predicted);
      expect(fullTotal(picture.target, picture.current)).toBe(predicted);
    }
  });
});
