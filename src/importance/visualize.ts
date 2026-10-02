import type { Bitmap } from '../engine/types';

/**
 * Renders an importance map as a greyscale picture for showing on the
 * page: the darkest pixel is the lowest weight, white is the highest.
 */
export function importanceToBitmap(weights: Float32Array, width: number, height: number): Bitmap {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < weights.length; i++) {
    if (weights[i] < min) min = weights[i];
    if (weights[i] > max) max = weights[i];
  }
  const range = max - min;

  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < weights.length; i++) {
    // No variation at all (e.g. a flat importance map): show mid grey
    // rather than claiming either extreme.
    const gray = range > 0 ? Math.round(((weights[i] - min) / range) * 255) : 128;
    const p = i * 4;
    data[p] = gray;
    data[p + 1] = gray;
    data[p + 2] = gray;
    data[p + 3] = 255;
  }
  return { width, height, data };
}
