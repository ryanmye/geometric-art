// Two fixes from the independent review (October 2026).
import { describe, expect, it } from 'vitest';
import { createRng, type Rng } from '../../src/engine/rng';
import { computeErrorGrid, sampleErrorGrid } from '../../src/engine/errorGrid';
import { createPicture } from '../../src/engine/picture';
import { createShapeContext, mutateShape, randomShape } from '../../src/engine/shapes';
import { fallbackTriangle, isValidTriangle } from '../../src/engine/shapes/triangle';
import type { Shape } from '../../src/engine/types';

type Triangle = Extract<Shape, { type: 'triangle' }>;

/** A generator that counts how many uniform numbers were drawn (a normal uses 12). */
function countingRng(seed: number): Rng & { count: number } {
  const base = createRng(seed);
  const rng = {
    count: 0,
    next() {
      rng.count++;
      return base.next();
    },
    int: (min: number, max: number) => min + Math.floor(rng.next() * (max - min + 1)),
    range: (min: number, max: number) => min + rng.next() * (max - min),
    normal() {
      let sum = 0;
      for (let i = 0; i < 12; i++) sum += rng.next();
      return sum - 6;
    },
  };
  return rng;
}

describe('error grid sampling', () => {
  it('stays inside the narrower last column instead of piling up on the edge', () => {
    // 500 x 375 with cells of 32 px: the last column is only 20 px wide.
    // All the error is in those last 20 columns.
    const width = 500;
    const height = 375;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        data.fill(x >= 480 ? 255 : 0, i, i + 3);
        data[i + 3] = 255;
      }
    }
    const grid = computeErrorGrid(createPicture({ width, height, data }, [0, 0, 0]));
    expect(grid.cellSize).toBe(32);
    const rng = createRng(1);
    let lastPixel = 0;
    const samples = 20000;
    for (let i = 0; i < samples; i++) {
      const [x, y] = sampleErrorGrid(grid, rng, width, height);
      expect(x).toBeGreaterThanOrEqual(480);
      expect(x).toBeLessThan(width);
      expect(y).toBeLessThan(height);
      if (x >= 499) lastPixel++;
    }
    // Uniform over 20 columns: about 5% in the last one (was 37% exactly on x = 500).
    expect(lastPixel / samples).toBeGreaterThan(0.03);
    expect(lastPixel / samples).toBeLessThan(0.07);
  });
});

describe('triangles on very wide or tall images', () => {
  it('mutate with a bounded number of random draws', () => {
    // Before the fix: about 40 draws per mutation at 256x256, 1,317 at 512x4 and 15,612 at 4096x1.
    const limits: Array<[number, number, number]> = [
      [256, 256, 80],
      [512, 170, 120],
      [512, 4, 500],
      [4096, 1, 500],
      [1, 4096, 500],
    ];
    for (const [width, height, limit] of limits) {
      const ctx = createShapeContext(width, height);
      const rng = countingRng(7);
      let t = randomShape('triangle', ctx, rng, width / 2, height / 2) as Triangle;
      rng.count = 0;
      const mutations = 300;
      for (let i = 0; i < mutations; i++) {
        t = mutateShape(t, ctx, rng) as Triangle;
        expect(isValidTriangle(ctx, t)).toBe(true);
      }
      expect(rng.count / mutations).toBeLessThan(limit);
    }
  });

  it('new random triangles are valid even when placed off the image', () => {
    const ctx = createShapeContext(4096, 1);
    const rng = createRng(2);
    for (let i = 0; i < 200; i++) {
      const t = randomShape('triangle', ctx, rng, rng.range(-50, 4146), rng.range(-50, 51)) as Triangle;
      expect(isValidTriangle(ctx, t)).toBe(true);
    }
  });

  it('the fallback triangle is centred on the clamped point and valid', () => {
    const ctx = createShapeContext(256, 256);
    for (const [x, y] of [
      [100, 100],
      [100, 256],
      [-40, 300],
      [256, 0],
    ]) {
      const t = fallbackTriangle(ctx, x, y);
      expect(isValidTriangle(ctx, t)).toBe(true);
      expect((t.x1 + t.x2 + t.x3) / 3).toBeCloseTo(Math.min(256, Math.max(0, x)), 10);
      expect((t.y1 + t.y2 + t.y3) / 3).toBeCloseTo(Math.min(256, Math.max(0, y)), 10);
    }
  });
});
