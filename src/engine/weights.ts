// Per-pixel weights: how much each pixel's error counts in the search.
//
// The page computes weights as ordinary decimal numbers with a mean of about
// 1 (see src/importance). The engine turns them, once, into whole numbers:
// scaled so the mean is WEIGHT_SCALE (256), rounded, and at least 1 so that
// no pixel is ever ignored. With whole-number weights every error total is
// still an exact integer, so a candidate's predicted total equals the total
// after painting it, with no rounding drift over thousands of shapes, and
// every machine and browser gets the same answer.
//
// How big can a weighted total get? Each pixel contributes at most
// weight * 3 * 255^2 = weight * 195075, so the total is at most
// 195075 * (sum of weights). The weights average about 256, so for a
// 512 x 512 image that is about 195075 * 256 * 262144 = 1.3e13, roughly
// 700 times below 2^53 (about 9e15), the largest integer a JavaScript number
// holds exactly. integerWeights() checks this bound and refuses weights that
// could break it.

import type { ImportanceInfo, RunnerOptions } from './types';

/** Weights are stored as whole numbers with this value meaning "average". */
export const WEIGHT_SCALE = 256;
/** The largest stored weight (they fit in 16 bits): 256 times the average. */
export const MAX_WEIGHT = 65535;
/** Largest possible squared RGB difference of one pixel: 3 * 255^2. */
const MAX_PIXEL_ERROR = 3 * 255 * 255;

/**
 * Turn decimal weights (one per pixel, any positive scale) into the engine's
 * whole-number weights. Throws a readable error for unusable input.
 */
export function integerWeights(weights: ArrayLike<number>, width: number, height: number): Uint16Array {
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

  // Scale so the average becomes WEIGHT_SCALE, then round to whole numbers.
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

/** Sum of all weights. */
export function weightSum(weights: Uint16Array): number {
  let sum = 0;
  for (let i = 0; i < weights.length; i++) sum += weights[i];
  return sum;
}

/** A run's weights, ready for the engine, and how they were made. */
export interface Weighting {
  weights: Uint16Array;
  importance: ImportanceInfo;
}

/** The weighting asked for in runner options, or null for an unweighted run. */
export function weightingFromOptions(
  options: Pick<RunnerOptions, 'weights' | 'importance'>,
  width: number,
  height: number,
): Weighting | null {
  if (!options.weights) return null;
  return { weights: integerWeights(options.weights, width, height), importance: { ...options.importance } };
}
