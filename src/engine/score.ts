// How far the picture is from the target.
//
// The engine works with the "total": the sum, over every pixel, of the
// squared differences in R, G and B (each 0-255). It is an exact integer
// (at most 512 * 512 * 3 * 255^2, about 5e10, well inside the 2^53 that a
// JavaScript number holds exactly), so comparing two candidates is exact.
//
// The score shown to people is the root-mean-square difference per channel,
// scaled to 0-1:  score = sqrt(total / (width * height * 3)) / 255.
//
// With per-pixel weights (see weights.ts) the search minimises the weighted
// total instead: each pixel's squared difference times its whole-number
// weight. That is still an exact integer. The reported score stays the plain
// one, so runs with and without weights can be compared.

import type { RGB } from './types';
import type { Picture } from './picture';
import { blend } from './blend';
import type { Scanlines } from './scanlines';

export function totalToScore(total: number, width: number, height: number): number {
  return Math.sqrt(total / (width * height * 3)) / 255;
}

/** Root-mean-square difference with weights: sqrt(weighted total / (3 * sum of weights)) / 255. */
export function weightedTotalToScore(total: number, weightSum: number): number {
  return Math.sqrt(total / (weightSum * 3)) / 255;
}

/** The weighted total over the whole image, computed from scratch. */
export function fullTotalWeighted(target: Uint8ClampedArray, current: Uint8ClampedArray, weights: Uint16Array): number {
  let total = 0;
  for (let p = 0; p < weights.length; p++) {
    const i = p * 4;
    const dr = target[i] - current[i];
    const dg = target[i + 1] - current[i + 1];
    const db = target[i + 2] - current[i + 2];
    total += weights[p] * (dr * dr + dg * dg + db * db);
  }
  return total;
}

/** The total over the whole image, computed from scratch. */
export function fullTotal(target: Uint8ClampedArray, current: Uint8ClampedArray): number {
  let total = 0;
  for (let i = 0; i < target.length; i += 4) {
    const dr = target[i] - current[i];
    const dg = target[i + 1] - current[i + 1];
    const db = target[i + 2] - current[i + 2];
    total += dr * dr + dg * dg + db * db;
  }
  return total;
}

/**
 * What the total would become if the shape (given as scanlines) were painted
 * in `color` at `alpha`, without changing the picture.
 *
 * Only the covered pixels change, so we start from the current total and,
 * for each covered pixel, take away its old squared error and add the error
 * it would have after painting. Blending and differencing happen in the same
 * pass, so no scratch copy of the picture is needed.
 */
export function totalAfterShape(picture: Picture, lines: Scanlines, color: RGB, alpha: number): number {
  if (picture.weights) return totalAfterShapeWeighted(picture, lines, color, alpha, picture.weights);
  const { target, current, width } = picture;
  const sr = color[0] * alpha + 127;
  const sg = color[1] * alpha + 127;
  const sb = color[2] * alpha + 127;
  const inverse = 255 - alpha;
  let total = picture.total;
  for (let k = 0; k < lines.count; k++) {
    const y = lines.data[3 * k];
    const x1 = lines.data[3 * k + 1];
    const x2 = lines.data[3 * k + 2];
    for (let i = (y * width + x1) * 4, end = (y * width + x2) * 4; i <= end; i += 4) {
      const tr = target[i];
      const tg = target[i + 1];
      const tb = target[i + 2];
      const br = current[i];
      const bg = current[i + 1];
      const bb = current[i + 2];
      // Error after painting this pixel ...
      const dr = tr - blend(sr, br, inverse);
      const dg = tg - blend(sg, bg, inverse);
      const db = tb - blend(sb, bb, inverse);
      // ... minus the error it has now.
      total +=
        dr * dr + dg * dg + db * db - ((tr - br) * (tr - br) + (tg - bg) * (tg - bg) + (tb - bb) * (tb - bb));
    }
  }
  return total;
}

/**
 * totalAfterShape() for a picture with weights: the same single pass, with
 * each pixel's change in squared error multiplied by its weight.
 */
function totalAfterShapeWeighted(
  picture: Picture,
  lines: Scanlines,
  color: RGB,
  alpha: number,
  weights: Uint16Array,
): number {
  const { target, current, width } = picture;
  const sr = color[0] * alpha + 127;
  const sg = color[1] * alpha + 127;
  const sb = color[2] * alpha + 127;
  const inverse = 255 - alpha;
  let total = picture.total;
  for (let k = 0; k < lines.count; k++) {
    const y = lines.data[3 * k];
    const x1 = lines.data[3 * k + 1];
    const x2 = lines.data[3 * k + 2];
    for (let p = y * width + x1, end = y * width + x2; p <= end; p++) {
      const i = p * 4;
      const tr = target[i];
      const tg = target[i + 1];
      const tb = target[i + 2];
      const br = current[i];
      const bg = current[i + 1];
      const bb = current[i + 2];
      const dr = tr - blend(sr, br, inverse);
      const dg = tg - blend(sg, bg, inverse);
      const db = tb - blend(sb, bb, inverse);
      total +=
        weights[p] *
        (dr * dr + dg * dg + db * db - ((tr - br) * (tr - br) + (tg - bg) * (tg - bg) + (tb - bb) * (tb - bb)));
    }
  }
  return total;
}
