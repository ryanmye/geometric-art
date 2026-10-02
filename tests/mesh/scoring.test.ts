import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/engine/rng';
import { runGeneration } from '../../src/mesh/optimizer';
import { createPixelSums, createRunTotals, sumRuns } from '../../src/mesh/pixelSums';
import { orient } from '../../src/mesh/predicates';
import { triangleSpans } from '../../src/mesh/rasterize';
import { rasterizeMesh } from '../../src/mesh/rasterizeMesh';
import { meshResult } from '../../src/mesh/result';
import { createMeshState, trackedError } from '../../src/mesh/state';
import { errorOf, gainOf, measureTriangle } from '../../src/mesh/triangleScore';
import { addTotals } from '../../src/mesh/slotTotals';
import { weightingFromOptions } from '../../src/mesh/weights';
import { computeImportance } from '../../src/importance';
import { loadFixture, smallConfig, squaredError } from './helpers';

const target = loadFixture();
const { width, height, data } = target;

describe('triangle sums', () => {
  it('row sums give the same totals as adding the pixels one by one (plain and weighted)', () => {
    const rng = createRng(5);
    const weights = new Uint16Array(width * height);
    for (let i = 0; i < weights.length; i++) weights[i] = rng.int(1, 2000);
    const sums = createPixelSums(target, weights);
    const runs = new Int32Array(3 * height);
    const totals = createRunTotals();
    for (let k = 0; k < 300; k++) {
      const p = Array.from({ length: 6 }, (_, i) => rng.int(0, i % 2 === 0 ? width : height));
      const count = triangleSpans(p[0], p[1], p[2], p[3], p[4], p[5], width, height, runs);
      sumRuns(sums, runs, count, totals);
      const brute = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      for (let i = 0; i < count; i++) {
        for (let x = runs[3 * i + 1]; x <= runs[3 * i + 2]; x++) {
          const pixel = runs[3 * i] * width + x;
          const [r, g, b] = [data[4 * pixel], data[4 * pixel + 1], data[4 * pixel + 2]];
          const q = r * r + g * g + b * b;
          const w = weights[pixel];
          const add = [1, r, g, b, q, w, w * r, w * g, w * b, w * q];
          for (let j = 0; j < 10; j++) brute[j] += add[j];
        }
      }
      expect([
        totals.count, totals.red, totals.green, totals.blue, totals.squares,
        totals.weight, totals.wRed, totals.wGreen, totals.wBlue, totals.wSquares,
      ]).toEqual(brute);
    }
  });

  it('a triangle covers exactly the pixel centres strictly inside it, plus some on its edges', () => {
    const runs = new Int32Array(3 * height);
    const rng = createRng(6);
    for (let k = 0; k < 200; k++) {
      let p = Array.from({ length: 6 }, (_, i) => rng.int(0, i % 2 === 0 ? width : height));
      const area = orient(p[0], p[1], p[2], p[3], p[4], p[5]);
      if (area === 0) continue;
      if (area < 0) p = [p[0], p[1], p[4], p[5], p[2], p[3]];
      const covered = new Uint8Array(width * height);
      const count = triangleSpans(p[0], p[1], p[2], p[3], p[4], p[5], width, height, runs);
      for (let i = 0; i < count; i++) {
        for (let x = runs[3 * i + 1]; x <= runs[3 * i + 2]; x++) covered[runs[3 * i] * width + x] = 1;
      }
      let wrong = 0;
      for (let py = 0; py < height; py++) {
        for (let px = 0; px < width; px++) {
          const cx = px + 0.5, cy = py + 0.5;
          const o0 = orient(p[0], p[1], p[2], p[3], cx, cy);
          const o1 = orient(p[2], p[3], p[4], p[5], cx, cy);
          const o2 = orient(p[4], p[5], p[0], p[1], cx, cy);
          const inside = o0 > 0 && o1 > 0 && o2 > 0;
          const outside = o0 < 0 || o1 < 0 || o2 < 0;
          if (inside && covered[py * width + px] !== 1) wrong++;
          if (outside && covered[py * width + px] !== 0) wrong++;
        }
      }
      expect(wrong).toBe(0);
    }
  });
});

describe('incremental score', () => {
  // The same check without and with per-pixel weights.
  const importance = computeImportance(target, { strength: 1 });
  for (const weighted of [false, true]) {
    it(`after many moves, every triangle score and the total match a from-scratch rescore${weighted ? ' (weighted)' : ''}`, () => {
      const weighting = weighted ? weightingFromOptions({ weights: importance, importance: { strength: 1 } }, width, height) : null;
      const weights = weighting ? weighting.weights : null;
      const state = createMeshState(target, smallConfig({ points: 200, generations: 60 }), weighting);
      for (let g = 0; g < 60; g++) runGeneration(state);
      expect(state.accepted).toBeGreaterThan(100);
      expect(state.refused).toBe(0);

      // Each cached triangle score equals a fresh measurement, exactly.
      const { tri, xs, ys } = state;
      let fresh = 0;
      for (let t = 0; t < tri.capacity; t++) {
        if (!tri.alive[t]) continue;
        const a = tri.corners[3 * t], b = tri.corners[3 * t + 1], c = tri.corners[3 * t + 2];
        const totals = measureTriangle(state.scorer, xs[a], ys[a], xs[b], ys[b], xs[c], ys[c]);
        const gain = gainOf(totals, weighted);
        expect(state.gain[t]).toBe(gain);
        expect(state.error[t]).toBe(errorOf(totals, weighted, gain));
        const stored = createRunTotals();
        addTotals(state.totals, t, stored);
        expect([stored.count, stored.red, stored.green, stored.blue, stored.weight, stored.wRed, stored.wGreen, stored.wBlue]).toEqual([
          totals.count, totals.red, totals.green, totals.blue, totals.weight, totals.wRed, totals.wGreen, totals.wBlue,
        ]);
        fresh += errorOf(totals, weighted, gain);
      }
      expect(trackedError(state)).toBe(fresh);

      // The tracked error (plain mean colours, each pixel counted by its
      // weight) matches a per-pixel brute force.
      const owner = new Int32Array(width * height).fill(-1);
      const runs = new Int32Array(3 * height);
      for (let t = 0; t < tri.capacity; t++) {
        if (!tri.alive[t]) continue;
        const a = tri.corners[3 * t], b = tri.corners[3 * t + 1], c = tri.corners[3 * t + 2];
        const n = triangleSpans(xs[a], ys[a], xs[b], ys[b], xs[c], ys[c], width, height, runs);
        for (let i = 0; i < n; i++) for (let x = runs[3 * i + 1]; x <= runs[3 * i + 2]; x++) owner[runs[3 * i] * width + x] = t;
      }
      const sum = new Float64Array(4 * tri.capacity);
      for (let i = 0; i < width * height; i++) {
        const t = owner[i];
        expect(t).toBeGreaterThanOrEqual(0);
        sum[4 * t] += 1;
        for (let c = 0; c < 3; c++) sum[4 * t + 1 + c] += data[4 * i + c];
      }
      let brute = 0;
      for (let i = 0; i < width * height; i++) {
        const t = owner[i];
        const w = weights ? weights[i] : 1;
        for (let c = 0; c < 3; c++) {
          const d = data[4 * i + c] - sum[4 * t + 1 + c] / sum[4 * t];
          brute += w * d * d;
        }
      }
      expect(Math.abs(trackedError(state) - brute) / brute).toBeLessThan(1e-9);

      // The reported scores are exactly the errors of the drawn mesh.
      const result = meshResult(state);
      const drawn = rasterizeMesh(result);
      expect(result.score).toBe(Math.sqrt(squaredError(drawn, target) / (3 * width * height)) / 255);
      if (weights) {
        let weightedTotal = 0;
        let weightSum = 0;
        for (let i = 0; i < width * height; i++) {
          weightSum += weights[i];
          for (let c = 0; c < 3; c++) {
            const d = drawn.data[4 * i + c] - data[4 * i + c];
            weightedTotal += weights[i] * d * d;
          }
        }
        expect(result.weightedScore).toBe(Math.sqrt(weightedTotal / (3 * weightSum)) / 255);
        expect(result.importance).toEqual({ strength: 1 });
      } else {
        expect('weightedScore' in result).toBe(false);
        expect('importance' in result).toBe(false);
      }
    });
  }
});
