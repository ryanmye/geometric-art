/**
 * Boosts pixels the user has painted over with a "put detail here" brush,
 * then renormalises so the mean weight is still 1.
 *
 * `mask` is the same size as `weights`: 0 means untouched, 255 means fully
 * painted. A fully painted pixel's weight is multiplied by `boost`; a
 * partly painted pixel gets a proportionally smaller multiplier.
 */
export function applyPaintedMask(weights: Float32Array, mask: Uint8Array, boost = 4): Float32Array {
  const boosted = new Float32Array(weights.length);
  let sum = 0;
  for (let i = 0; i < weights.length; i++) {
    const paintedFraction = mask[i] / 255;
    const multiplier = 1 + (boost - 1) * paintedFraction;
    const value = weights[i] * multiplier;
    boosted[i] = value;
    sum += value;
  }

  const mean = sum / weights.length;
  for (let i = 0; i < boosted.length; i++) {
    boosted[i] = boosted[i] / mean;
  }
  return boosted;
}
