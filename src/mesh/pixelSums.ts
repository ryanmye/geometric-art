// Running sums along each row of the target image, so the total colour of
// any run of pixels costs two lookups instead of a loop.
//
// For channel R, red[row * (width + 1) + x] is the sum of the red values of
// pixels 0 .. x-1 in that row; the run from pixel x1 to x2 sums to
// red[i + x2 + 1] - red[i + x1]. `squares` does the same for
// r*r + g*g + b*b. All sums are whole numbers below 2^53, so they are exact.
//
// With per-pixel weights w (whole numbers, see weights.ts) there are five
// more: the sums of w, w*r, w*g, w*b and w*(r*r + g*g + b*b).

import type { Bitmap } from '../engine/types';

export interface PixelSums {
  width: number;
  height: number;
  red: Float64Array;
  green: Float64Array;
  blue: Float64Array;
  squares: Float64Array;
  /** Sum of r*r + g*g + b*b over the whole image. */
  totalSquares: number;
  /** Weighted sums, or null for an unweighted run. */
  weighted: WeightedSums | null;
}

export interface WeightedSums {
  weight: Float64Array;
  red: Float64Array;
  green: Float64Array;
  blue: Float64Array;
  squares: Float64Array;
}

export function createPixelSums(target: Bitmap, weights: Uint16Array | null = null): PixelSums {
  const { width, height, data } = target;
  const stride = width + 1;
  const size = stride * height;
  const red = new Float64Array(size);
  const green = new Float64Array(size);
  const blue = new Float64Array(size);
  const squares = new Float64Array(size);
  const weighted: WeightedSums | null = weights
    ? {
        weight: new Float64Array(size),
        red: new Float64Array(size),
        green: new Float64Array(size),
        blue: new Float64Array(size),
        squares: new Float64Array(size),
      }
    : null;
  let totalSquares = 0;
  for (let y = 0; y < height; y++) {
    let r = 0, g = 0, b = 0, q = 0;
    let w = 0, wr = 0, wg = 0, wb = 0, wq = 0;
    const row = y * stride;
    for (let x = 0; x < width; x++) {
      const p = 4 * (y * width + x);
      const pr = data[p], pg = data[p + 1], pb = data[p + 2];
      const pq = pr * pr + pg * pg + pb * pb;
      r += pr;
      g += pg;
      b += pb;
      q += pq;
      red[row + x + 1] = r;
      green[row + x + 1] = g;
      blue[row + x + 1] = b;
      squares[row + x + 1] = q;
      if (weighted && weights) {
        const pw = weights[y * width + x];
        w += pw;
        wr += pw * pr;
        wg += pw * pg;
        wb += pw * pb;
        wq += pw * pq;
        weighted.weight[row + x + 1] = w;
        weighted.red[row + x + 1] = wr;
        weighted.green[row + x + 1] = wg;
        weighted.blue[row + x + 1] = wb;
        weighted.squares[row + x + 1] = wq;
      }
    }
    totalSquares += q;
  }
  return { width, height, red, green, blue, squares, totalSquares, weighted };
}

/** Totals over a set of pixel runs. The w* fields stay 0 in an unweighted run. */
export interface RunTotals {
  count: number;
  red: number;
  green: number;
  blue: number;
  squares: number;
  weight: number;
  wRed: number;
  wGreen: number;
  wBlue: number;
  wSquares: number;
}

export function createRunTotals(): RunTotals {
  return { count: 0, red: 0, green: 0, blue: 0, squares: 0, weight: 0, wRed: 0, wGreen: 0, wBlue: 0, wSquares: 0 };
}

/** Add up the pixels of `runCount` runs (as written by triangleSpans) into `out`. */
export function sumRuns(sums: PixelSums, runs: Int32Array, runCount: number, out: RunTotals): void {
  const stride = sums.width + 1;
  let count = 0, r = 0, g = 0, b = 0, q = 0;
  for (let i = 0; i < runCount; i++) {
    const row = runs[3 * i] * stride;
    const start = row + runs[3 * i + 1];
    const end = row + runs[3 * i + 2] + 1;
    count += end - start;
    r += sums.red[end] - sums.red[start];
    g += sums.green[end] - sums.green[start];
    b += sums.blue[end] - sums.blue[start];
    q += sums.squares[end] - sums.squares[start];
  }
  out.count = count;
  out.red = r;
  out.green = g;
  out.blue = b;
  out.squares = q;

  const weighted = sums.weighted;
  if (!weighted) return;
  let w = 0, wr = 0, wg = 0, wb = 0, wq = 0;
  for (let i = 0; i < runCount; i++) {
    const row = runs[3 * i] * stride;
    const start = row + runs[3 * i + 1];
    const end = row + runs[3 * i + 2] + 1;
    w += weighted.weight[end] - weighted.weight[start];
    wr += weighted.red[end] - weighted.red[start];
    wg += weighted.green[end] - weighted.green[start];
    wb += weighted.blue[end] - weighted.blue[start];
    wq += weighted.squares[end] - weighted.squares[start];
  }
  out.weight = w;
  out.wRed = wr;
  out.wGreen = wg;
  out.wBlue = wb;
  out.wSquares = wq;
}
