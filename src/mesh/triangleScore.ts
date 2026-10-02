// How well one triangle matches the target.
//
// Unweighted: a triangle is drawn in the mean colour of its pixels, so its
// squared error is   sum over its pixels of |pixel - mean|^2
//                  = sumOfSquares - |sum|^2 / count.
// The second term, |sum|^2 / count, is the triangle's "gain". The error of
// the whole mesh is (sum of squares of every pixel) - (sum of all gains),
// so the optimiser only has to raise the total gain.
//
// Weighted (each pixel's error counted w times): with W = sum of w and
// Sw = sum of w * pixel, the colour that minimises the weighted error is
// the weighted mean Sw / W, whose error is  wSquares - |Sw|^2 / W.
// The triangle is still filled with the plain mean m (filling with the
// weighted mean was tried: no better-looking, and slightly higher plain and
// weighted error on the Mona Lisa); the extra error that costs is
// W * |Sw / W - m|^2, so
//   gain = |Sw|^2 / W - W * |Sw / W - m|^2,   error = wSquares - gain.
// With equal weights the two means are identical and the extra term is
// exactly 0, so the run is exactly the unweighted run scaled.

import { sumRuns, type PixelSums, type RunTotals } from './pixelSums';
import { createRunTotals } from './pixelSums';
import { triangleSpans } from './rasterize';

export interface TriangleScorer {
  sums: PixelSums;
  runs: Int32Array;
  totals: RunTotals;
}

export function createTriangleScorer(sums: PixelSums): TriangleScorer {
  return { sums, runs: new Int32Array(3 * sums.height), totals: createRunTotals() };
}

/** Add up the target pixels of triangle (a, b, c) into scorer.totals. */
export function measureTriangle(
  scorer: TriangleScorer,
  ax: number, ay: number, bx: number, by: number, cx: number, cy: number,
): RunTotals {
  const { sums, runs, totals } = scorer;
  const runCount = triangleSpans(ax, ay, bx, by, cx, cy, sums.width, sums.height, runs);
  sumRuns(sums, runs, runCount, totals);
  return totals;
}

/** The triangle's gain (see above); 0 for a triangle that covers no pixel centre. */
export function gainOf(totals: RunTotals, weighted: boolean): number {
  if (totals.count === 0) return 0;
  if (!weighted) {
    return (totals.red * totals.red + totals.green * totals.green + totals.blue * totals.blue) / totals.count;
  }
  const w = totals.weight;
  const best = (totals.wRed * totals.wRed + totals.wGreen * totals.wGreen + totals.wBlue * totals.wBlue) / w;
  const dr = totals.wRed / w - totals.red / totals.count;
  const dg = totals.wGreen / w - totals.green / totals.count;
  const db = totals.wBlue / w - totals.blue / totals.count;
  return best - w * (dr * dr + dg * dg + db * db);
}

/** The triangle's (weighted) squared error, given its gain. */
export function errorOf(totals: RunTotals, weighted: boolean, gain: number): number {
  return (weighted ? totals.wSquares : totals.squares) - gain;
}
