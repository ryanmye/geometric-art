/**
 * Painting colour s with opacity alpha (1-255) over an existing value d gives
 *   round((s * alpha + d * (255 - alpha)) / 255).
 * Search and painting both use this, so a shape's predicted score is exact.
 * `sTimesAlpha` is s * alpha + 127 (the 127 makes the division round).
 */
export function blend(sTimesAlpha: number, d: number, inverseAlpha: number): number {
  return ((sTimesAlpha + d * inverseAlpha) / 255) | 0;
}
