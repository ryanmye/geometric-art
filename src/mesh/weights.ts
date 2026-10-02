// Optional per-pixel weights: how much each pixel's error counts.
//
// The page computes weights as decimal numbers with a mean of about 1
// (computeImportance in src/importance). They are turned, once, into whole
// numbers: scaled so the mean is WEIGHT_SCALE (256), rounded, at least 1 so
// no pixel is ever ignored. With whole-number weights every weighted sum
// over a run of pixels is an exact integer, so the optimiser's running
// score still equals a from-scratch rescore, on every machine.
//
// Bound: a pixel adds at most weight * 3 * 255^2 to a sum, so all sums stay
// below 195075 * (sum of weights), which is checked to be under 2^53.

import type { ImportanceInfo } from '../engine/types';

/** A run's weights, ready for the engine, and how they were made. */
export interface MeshWeighting {
  weights: Uint16Array;
  importance: ImportanceInfo;
}

/** The weighting asked for in runner options, or null for an unweighted run. */
export function weightingFromOptions(
  options: { weights?: ArrayLike<number>; importance?: ImportanceInfo },
  width: number,
  height: number,
): MeshWeighting | null {
  if (!options.weights) return null;
  return { weights: meshWeights(options.weights, width, height), importance: { ...options.importance } };
}

/** Weights are stored as whole numbers with this value meaning "average". */
export const WEIGHT_SCALE = 256;
const MAX_WEIGHT = 65535;
const MAX_PIXEL_ERROR = 3 * 255 * 255;

/** Turn decimal weights (one per pixel, row-major) into whole-number weights. */
export function meshWeights(weights: ArrayLike<number>, width: number, height: number): Uint16Array {
  const pixels = width * height;
  if (weights.length !== pixels) {
    throw new Error(`Weights must have one value per pixel (${pixels}), got ${weights.length}`);
  }
  let sum = 0;
  for (let i = 0; i < pixels; i++) {
    const w = weights[i];
    if (!(w >= 0) || !Number.isFinite(w)) throw new Error(`Weight ${i} is ${w}; weights must be 0 or more`);
    sum += w;
  }
  if (!(sum > 0)) throw new Error('Weights are all zero');

  const scale = (WEIGHT_SCALE * pixels) / sum;
  const result = new Uint16Array(pixels);
  let integerSum = 0;
  for (let i = 0; i < pixels; i++) {
    const w = Math.round(weights[i] * scale);
    result[i] = w < 1 ? 1 : w > MAX_WEIGHT ? MAX_WEIGHT : w;
    integerSum += result[i];
  }
  if (integerSum * MAX_PIXEL_ERROR > Number.MAX_SAFE_INTEGER) {
    throw new Error('These weights are too large for exact error totals');
  }
  return result;
}
