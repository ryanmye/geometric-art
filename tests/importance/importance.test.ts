import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { computeImportance, DEFAULT_IMPORTANCE_OPTIONS } from '../../src/importance/importance';
import type { Bitmap } from '../../src/engine/types';
import { flatBitmap, meanOf, verticalEdgeBitmap } from './helpers';

function loadFixture(): Bitmap {
  const path = fileURLToPath(new URL('../fixtures/mona-lisa-256.png', import.meta.url));
  const png = PNG.sync.read(readFileSync(path));
  return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) };
}

describe('computeImportance', () => {
  it('gives every pixel exactly 1 on a flat image, at any strength', () => {
    const target = flatBitmap(40, 30);
    for (const strength of [0, 0.5, 1]) {
      const weights = computeImportance(target, { strength });
      for (let i = 0; i < weights.length; i++) expect(weights[i]).toBe(1);
    }
  });

  it('gives every pixel exactly 1 at strength 0, on a busy image', () => {
    const weights = computeImportance(loadFixture(), { strength: 0 });
    for (let i = 0; i < weights.length; i++) expect(weights[i]).toBe(1);
  });

  it('has mean weight 1 on several kinds of image', () => {
    const images = [flatBitmap(50, 50), verticalEdgeBitmap(64, 48), loadFixture()];
    for (const target of images) {
      for (const strength of [0.25, 1]) {
        const weights = computeImportance(target, { strength });
        expect(meanOf(weights)).toBeCloseTo(1, 5);
      }
    }
  });

  it('never produces a weight at or below zero', () => {
    const images = [flatBitmap(30, 30, [0, 0, 0]), verticalEdgeBitmap(64, 48), loadFixture()];
    for (const target of images) {
      const weights = computeImportance(target, { strength: 1 });
      for (let i = 0; i < weights.length; i++) expect(weights[i]).toBeGreaterThan(0);
    }
  });

  it('weighs the fixture face and outline roughly 5-10x the flattest areas, at full strength', () => {
    const weights = computeImportance(loadFixture(), { strength: 1 });
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < weights.length; i++) {
      if (weights[i] < min) min = weights[i];
      if (weights[i] > max) max = weights[i];
    }
    expect(max / min).toBeGreaterThan(5);
    expect(max / min).toBeLessThan(10);
  });

  it('puts the highest weights on a sharp vertical edge, symmetric about it', () => {
    const width = 80;
    const height = 20;
    const target = verticalEdgeBitmap(width, height);
    const weights = computeImportance(target, { strength: 1 });

    const row = 10;
    const centre = width / 2;
    // The weight right at the edge should beat weight far away from it.
    expect(weights[row * width + Math.floor(centre)]).toBeGreaterThan(weights[row * width + 5]);
    expect(weights[row * width + Math.floor(centre)]).toBeGreaterThan(weights[row * width + width - 5]);

    // Symmetric: a point `d` pixels left of the edge should weigh about
    // the same as a point `d` pixels right of it.
    for (const d of [2, 4, 8]) {
      const left = weights[row * width + (centre - d)];
      const right = weights[row * width + (centre + d - 1)]; // edge sits between the two middle columns
      expect(left).toBeCloseTo(right, 3);
    }
  });

  it('gives bit-identical output for the same input run twice', () => {
    const target = loadFixture();
    const a = computeImportance(target, { strength: 1 });
    const b = computeImportance(target, { strength: 1 });
    expect(a).toEqual(b);
  });

  it('defaults to strength 1, a 3% blur and an 0.08 floor', () => {
    expect(DEFAULT_IMPORTANCE_OPTIONS).toEqual({ strength: 1, blurFraction: 0.03, floor: 0.08 });
  });

  it('matches hand-checked weights on a tiny 2x2 image (catches future arithmetic drift)', () => {
    // Top-left and bottom-right black, top-right and bottom-left white:
    // a small, fully deterministic case to pin exact values down.
    const data = new Uint8ClampedArray([
      0, 0, 0, 255, 255, 255, 255, 255,
      255, 255, 255, 255, 0, 0, 0, 255,
    ]);
    const target: Bitmap = { width: 2, height: 2, data };
    const weights = computeImportance(target, { strength: 1, blurFraction: 0.03 });
    // blurFraction * longer side (2) rounds to 0, so no blur is applied;
    // every pixel has the same Sobel magnitude by symmetry, so the map is
    // flat and normalises to exactly 1 everywhere.
    expect(Array.from(weights)).toEqual([1, 1, 1, 1]);
  });
});
