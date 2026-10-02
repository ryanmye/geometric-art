// The picture being built, next to the target it is trying to match.

import type { Bitmap, RGB } from './types';
import type { Scanlines } from './scanlines';
import { fullTotal, fullTotalWeighted } from './score';
import { blend } from './blend';
import { weightSum } from './weights';

export interface Picture {
  width: number;
  height: number;
  /** Target RGBA bytes (alpha is ignored everywhere). */
  target: Uint8ClampedArray;
  /** Current picture, RGBA bytes, same layout as target. */
  current: Uint8ClampedArray;
  /**
   * What the search minimises: the sum over every pixel of the squared R, G
   * and B differences between target and current, each pixel's multiplied
   * by its weight when there are weights. Kept as an exact integer so
   * comparisons between candidate shapes never suffer from rounding. See
   * score.ts and weights.ts.
   */
  total: number;
  /** The same sum without weights (equal to `total` when there are none); used for the reported score. */
  plainTotal: number;
  /** Whole-number weight of each pixel (see weights.ts), or null when every pixel counts the same. */
  weights: Uint16Array | null;
  /** Sum of `weights` (or the pixel count when there are none). */
  weightSum: number;
}

/** Average colour of the image, each channel rounded to an integer. */
export function averageColor(image: Bitmap): RGB {
  let r = 0;
  let g = 0;
  let b = 0;
  const pixels = image.width * image.height;
  for (let i = 0; i < pixels * 4; i += 4) {
    r += image.data[i];
    g += image.data[i + 1];
    b += image.data[i + 2];
  }
  return [Math.round(r / pixels), Math.round(g / pixels), Math.round(b / pixels)];
}

/**
 * A picture filled with `background`, compared against a private copy of
 * `target`, optionally with per-pixel weights from integerWeights().
 */
export function createPicture(target: Bitmap, background: RGB, weights: Uint16Array | null = null): Picture {
  const { width, height } = target;
  const targetCopy = new Uint8ClampedArray(target.data);
  const current = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < current.length; i += 4) {
    current[i] = background[0];
    current[i + 1] = background[1];
    current[i + 2] = background[2];
    current[i + 3] = 255;
  }
  const plainTotal = fullTotal(targetCopy, current);
  return {
    width,
    height,
    target: targetCopy,
    current,
    total: weights ? fullTotalWeighted(targetCopy, current, weights) : plainTotal,
    plainTotal,
    weights,
    weightSum: weights ? weightSum(weights) : width * height,
  };
}

/**
 * Paint a shape (given as scanlines) onto the current picture in a flat
 * colour and update the running total.
 */
export function paint(picture: Picture, lines: Scanlines, color: RGB, alpha: number): void {
  if (picture.weights) {
    paintWeighted(picture, lines, color, alpha, picture.weights);
    return;
  }
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
      const ar = blend(sr, br, inverse);
      const ag = blend(sg, bg, inverse);
      const ab = blend(sb, bb, inverse);
      current[i] = ar;
      current[i + 1] = ag;
      current[i + 2] = ab;
      total +=
        (tr - ar) * (tr - ar) + (tg - ag) * (tg - ag) + (tb - ab) * (tb - ab) -
        ((tr - br) * (tr - br) + (tg - bg) * (tg - bg) + (tb - bb) * (tb - bb));
    }
  }
  picture.total = total;
  picture.plainTotal = total;
}

/** paint() for a picture with weights: the same, but keeps both totals. */
function paintWeighted(picture: Picture, lines: Scanlines, color: RGB, alpha: number, weights: Uint16Array): void {
  const { target, current, width } = picture;
  const sr = color[0] * alpha + 127;
  const sg = color[1] * alpha + 127;
  const sb = color[2] * alpha + 127;
  const inverse = 255 - alpha;
  let total = picture.total;
  let plainTotal = picture.plainTotal;
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
      const ar = blend(sr, br, inverse);
      const ag = blend(sg, bg, inverse);
      const ab = blend(sb, bb, inverse);
      current[i] = ar;
      current[i + 1] = ag;
      current[i + 2] = ab;
      const change =
        (tr - ar) * (tr - ar) + (tg - ag) * (tg - ag) + (tb - ab) * (tb - ab) -
        ((tr - br) * (tr - br) + (tg - bg) * (tg - bg) + (tb - bb) * (tb - bb));
      plainTotal += change;
      total += weights[p] * change;
    }
  }
  picture.total = total;
  picture.plainTotal = plainTotal;
}
