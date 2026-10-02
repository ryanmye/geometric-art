import { describe, expect, it } from 'vitest';
import type { Bitmap, RGB, RunConfig } from '../../src/engine/types';
import { SHAPE_TYPES } from '../../src/engine/types';
import { integerWeights, MAX_WEIGHT, WEIGHT_SCALE } from '../../src/engine/weights';
import { computeColor } from '../../src/engine/color';
import { createPicture, paint } from '../../src/engine/picture';
import { fullTotal, fullTotalWeighted, totalAfterShape } from '../../src/engine/score';
import { createScanlines } from '../../src/engine/scanlines';
import { createShapeContext, randomShape, rasterizeShape } from '../../src/engine/shapes';
import { createRng } from '../../src/engine/rng';
import { createAnimationRunner } from '../../src/engine/animationRunner';
import { computeImportance } from '../../src/importance';
import { loadFixture, runToEnd, smallConfig } from './helpers';

const fixture = loadFixture();

function noiseBitmap(width: number, height: number, seed: number): Bitmap {
  const rng = createRng(seed);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i++) data[i] = rng.int(0, 255);
  return { width, height, data };
}

function randomWeights(count: number, seed: number): Float32Array {
  const rng = createRng(seed);
  const weights = new Float32Array(count);
  // Mostly around 1, some very light and some very heavy pixels.
  for (let i = 0; i < count; i++) weights[i] = rng.next() < 0.1 ? rng.range(0, 0.01) : rng.range(0.2, 8);
  return weights;
}

describe('whole-number weights', () => {
  it('scale to an average of 256, never below 1, and reject bad input', () => {
    expect(Array.from(integerWeights([1, 1, 1, 1], 2, 2))).toEqual([256, 256, 256, 256]);
    expect(Array.from(integerWeights([2, 2, 2, 2], 2, 2))).toEqual([256, 256, 256, 256]);
    expect(Array.from(integerWeights([0, 1, 3, 0], 2, 2))).toEqual([1, 256, 768, 1]);
    expect(() => integerWeights([1, 1, 1], 2, 2)).toThrow(/one value per pixel/);
    expect(() => integerWeights([1, -1, 1, 1], 2, 2)).toThrow(/0 or more/);
    expect(() => integerWeights([0, 0, 0, 0], 2, 2)).toThrow(/all zero/);
  });

  it('keep the largest possible total of a 512 x 512 image far below 2^53', () => {
    // A very uneven map: one pixel 10,000 times heavier than the rest.
    const pixels = 512 * 512;
    const raw = new Float32Array(pixels).fill(1);
    raw[0] = 10000;
    const weights = integerWeights(raw, 512, 512);
    let sum = 0;
    let max = 0;
    for (const w of weights) {
      sum += w;
      max = Math.max(max, w);
    }
    expect(max).toBeLessThanOrEqual(MAX_WEIGHT);
    // Every pixel at the worst possible error: 3 * 255^2 each.
    expect(sum * 3 * 255 * 255).toBeLessThan(Number.MAX_SAFE_INTEGER / 100);
    expect(sum).toBeLessThan(pixels * WEIGHT_SCALE * 1.05);
  });
});

describe('weighted colour', () => {
  it('is the weighted-mean formula on a hand-worked case', () => {
    // Two pixels, current 100. Targets 110 (weight 1) and 130 (weight 3).
    // Weighted mean target = (110 + 3 * 130) / 4 = 125.
    const target: Bitmap = { width: 2, height: 1, data: new Uint8ClampedArray([110, 50, 0, 255, 130, 50, 0, 255]) };
    const picture = createPicture(target, [100, 100, 100], integerWeights([1, 3], 2, 1));
    const lines = createScanlines(1);
    rasterizeShape({ type: 'rectangle', x1: 0, y1: 0, x2: 2, y2: 1 }, lines, 2, 1);
    // Opaque: just the weighted mean target (blue: mean 0).
    expect(computeColor(picture, lines, 255)).toEqual([125, 50, 0]);
    // At opacity 0.2: c = 100 + (125 - 100) / 0.2 = 225; green 100 + (50 - 100) * 5 < 0 -> 0.
    expect(computeColor(picture, lines, 51)).toEqual([225, 0, 0]);
  });
});

describe('weighted differential score', () => {
  it('equals a full weighted rescore after painting, with no drift over 3000 shapes', () => {
    const width = 64;
    const height = 48;
    const weights = integerWeights(randomWeights(width * height, 5), width, height);
    const picture = createPicture(noiseBitmap(width, height, 3), [90, 140, 30], weights);
    const ctx = { ...createShapeContext(width, height), unit: 1 };
    const rng = createRng(11);
    const lines = createScanlines(height);
    for (let i = 0; i < 3000; i++) {
      const type = SHAPE_TYPES[i % SHAPE_TYPES.length];
      const shape = randomShape(type, ctx, rng, rng.range(0, width), rng.range(0, height));
      const alpha = rng.int(1, 255);
      rasterizeShape(shape, lines, width, height);
      const color: RGB = computeColor(picture, lines, alpha);
      const predicted = totalAfterShape(picture, lines, color, alpha);
      paint(picture, lines, color, alpha);
      expect(picture.total).toBe(predicted);
      if (i % 100 === 0 || i === 2999) {
        expect(fullTotalWeighted(picture.target, picture.current, weights)).toBe(picture.total);
        expect(fullTotal(picture.target, picture.current)).toBe(picture.plainTotal);
      }
    }
  });
});

describe('weighted runs', () => {
  const config: RunConfig = smallConfig({ maxShapes: 12, seed: 3 });
  const importance = computeImportance(fixture, { strength: 1 });

  it('all-ones weights give exactly the unweighted result', async () => {
    const plain = await runToEnd(fixture, config);
    const ones = await runToEnd(fixture, config, { weights: new Float32Array(fixture.width * fixture.height).fill(1) });
    expect(ones.result.shapes).toEqual(plain.result.shapes);
    expect(ones.result.score).toBe(plain.result.score);
    expect(ones.result.weightedScore).toBe(plain.result.score);
    expect(ones.result.importance).toEqual({});
    expect(plain.result.importance).toBeUndefined();
    expect(plain.result.weightedScore).toBeUndefined();
  });

  it('are reproducible across any split of the climbs, and record how the weights were made', async () => {
    const options = { weights: importance, importance: { strength: 1, painted: false } };
    const one = await runToEnd(fixture, config, { ...options, workerCount: 1 });
    const four = await runToEnd(fixture, config, { ...options, workerCount: 4 });
    expect(JSON.stringify(four.result)).toBe(JSON.stringify(one.result));
    expect(one.result.importance).toEqual({ strength: 1, painted: false });
    expect(one.result.weightedScore).toBeGreaterThan(0);
    // Weights change the search.
    const plain = await runToEnd(fixture, config);
    expect(one.result.shapes).not.toEqual(plain.result.shapes);
    // Continuing from a prefix with the same weights gives the same run.
    const resumed = await runToEnd(fixture, config, { ...options, prefix: one.result.shapes.slice(0, 5) });
    expect(resumed.result).toEqual(one.result);
  });

  it('pull shapes towards heavily weighted areas', async () => {
    // Weight the top-left quarter 20 times more than the rest.
    const { width, height } = fixture;
    const weights = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) weights[y * width + x] = x < width / 2 && y < height / 2 ? 20 : 1;
    }
    const inTopLeft = (shapes: Array<{ shape: { type: string } & Record<string, unknown> }>) =>
      shapes.filter(({ shape }) => {
        const s = shape as Record<string, number>;
        const cx = shape.type === 'triangle' ? (s.x1 + s.x2 + s.x3) / 3 : shape.type === 'rectangle' ? (s.x1 + s.x2) / 2 : s.cx;
        const cy = shape.type === 'triangle' ? (s.y1 + s.y2 + s.y3) / 3 : shape.type === 'rectangle' ? (s.y1 + s.y2) / 2 : s.cy;
        return cx < width / 2 && cy < height / 2;
      }).length;
    const focused = await runToEnd(fixture, smallConfig({ maxShapes: 40 }), { weights });
    const plain = await runToEnd(fixture, smallConfig({ maxShapes: 40 }));
    // The quarter is a quarter of the image; with its pixels weighing 20 times
    // more, clearly more of the shapes go there.
    expect(inTopLeft(focused.result.shapes)).toBeGreaterThanOrEqual(inTopLeft(plain.result.shapes) * 1.5);
  });

  it('an animation uses the same weights for every frame', async () => {
    const options = { weights: importance, importance: { strength: 1 } };
    const animation = await new Promise<import('../../src/engine/types').AnimationResult>((resolve, reject) =>
      createAnimationRunner(
        fixture,
        config,
        { frames: 3, shared: 4 },
        { onDone: resolve, onError: reject },
        { executor: 'inline', ...options },
      ).start(),
    );
    expect(animation.importance).toEqual({ strength: 1 });
    const single = await runToEnd(fixture, config, options);
    expect(animation.frames[0]).toEqual(single.result);
    for (let i = 1; i < 3; i++) {
      const alone = await runToEnd(fixture, { ...config, seed: config.seed + i }, { ...options, prefix: animation.prefix });
      expect(animation.frames[i]).toEqual(alone.result);
    }
  });
});
