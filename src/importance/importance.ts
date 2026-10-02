import type { Bitmap } from '../engine/types';
import { computeLuminance } from './luminance';
import { sobelMagnitude } from './sobel';
import { boxBlur } from './blur';

export interface ImportanceOptions {
  /**
   * How much weight edges carry, 0 to 1. 0 makes every pixel weigh the
   * same (a flat map of all 1s); 1 is the full effect described below.
   */
  strength: number;
  /**
   * Blur radius for spreading edge strength into the area around an edge,
   * as a fraction of the longer image side (so it scales with image size).
   */
  blurFraction: number;
  /**
   * At strength 1, the least-important pixel (no nearby edge at all)
   * weighs this much before the map is normalised, against 1 for the
   * most-important pixel (right on the strongest edge). Keeping this
   * above 0 is what guarantees no weight ever reaches zero. Smaller
   * values make the gap between "important" and "unimportant" bigger.
   */
  floor: number;
}

export const DEFAULT_IMPORTANCE_OPTIONS: ImportanceOptions = {
  strength: 1,
  blurFraction: 0.03,
  floor: 0.08,
};

/**
 * One weight per pixel of `target`, row-major, saying how much that
 * pixel's error should count when scoring a candidate shape. Built from
 * the Sobel edge strength of the image, blurred so the area around an
 * edge counts and not just a one-pixel line.
 *
 * The mean weight is always exactly 1, so a weighted error total stays on
 * the same scale as an unweighted one.
 */
export function computeImportance(target: Bitmap, options: Partial<ImportanceOptions> = {}): Float32Array {
  const { strength, blurFraction, floor } = { ...DEFAULT_IMPORTANCE_OPTIONS, ...options };
  const { width, height } = target;
  const pixelCount = width * height;

  const luminance = computeLuminance(target);
  const edges = sobelMagnitude(luminance, width, height);

  const longerSide = Math.max(width, height);
  const radius = Math.round(blurFraction * longerSide);
  const blurred = boxBlur(edges, width, height, radius);

  let maxBlurred = 0;
  for (let i = 0; i < pixelCount; i++) {
    if (blurred[i] > maxBlurred) maxBlurred = blurred[i];
  }

  const weights = new Float32Array(pixelCount);
  let sum = 0;
  for (let i = 0; i < pixelCount; i++) {
    // Edge strength relative to the strongest edge in the image, 0 to 1.
    const normalisedEdge = maxBlurred > 0 ? blurred[i] / maxBlurred : 0;
    // 1 right on the strongest edge, down to `floor` with no edge nearby.
    const effect = floor + (1 - floor) * normalisedEdge;
    // Blend between "flat" (1 everywhere) and the full effect by strength.
    const weight = 1 + strength * (effect - 1);
    weights[i] = weight;
    sum += weight;
  }

  const mean = sum / pixelCount;
  for (let i = 0; i < pixelCount; i++) {
    weights[i] = weights[i] / mean;
  }
  return weights;
}
