import type { RGB } from './types';
import type { Picture } from './picture';
import type { Scanlines } from './scanlines';

/**
 * The best flat colour for a shape, worked out directly rather than searched
 * for (primitive's computeColor).
 *
 * Painting colour c at opacity a = alpha / 255 turns a current pixel d into
 * a*c + (1 - a)*d. We want that as close as possible to the target t over
 * all covered pixels, i.e. we minimise  sum of (t - a*c - (1 - a)*d)^2.
 * Setting the derivative with respect to c to zero gives
 *   a*c = mean(t) - (1 - a)*mean(d),   so   c = mean(d) + (mean(t) - mean(d)) / a.
 * Each channel is solved separately, then rounded and clamped to 0-255.
 */
export function computeColor(picture: Picture, lines: Scanlines, alpha: number): RGB {
  if (picture.weights) return computeColorWeighted(picture, lines, alpha, picture.weights);
  const { target, current, width } = picture;
  let targetR = 0;
  let targetG = 0;
  let targetB = 0;
  let currentR = 0;
  let currentG = 0;
  let currentB = 0;
  let count = 0;
  for (let k = 0; k < lines.count; k++) {
    const y = lines.data[3 * k];
    const x1 = lines.data[3 * k + 1];
    const x2 = lines.data[3 * k + 2];
    for (let i = (y * width + x1) * 4, end = (y * width + x2) * 4; i <= end; i += 4) {
      targetR += target[i];
      targetG += target[i + 1];
      targetB += target[i + 2];
      currentR += current[i];
      currentG += current[i + 1];
      currentB += current[i + 2];
    }
    count += x2 - x1 + 1;
  }
  if (count === 0) return [0, 0, 0];
  const scale = 255 / alpha; // 1 / a
  return [
    bestChannel(targetR, currentR, count, scale),
    bestChannel(targetG, currentG, count, scale),
    bestChannel(targetB, currentB, count, scale),
  ];
}

function bestChannel(targetSum: number, currentSum: number, count: number, scale: number): number {
  const value = (currentSum + (targetSum - currentSum) * scale) / count;
  return Math.min(255, Math.max(0, Math.round(value)));
}

/**
 * The best colour when pixels have weights w. Now we minimise
 *   sum of w * (t - a*c - (1 - a)*d)^2.
 * The derivative with respect to c is -2a * sum of w * (t - a*c - (1 - a)*d);
 * setting it to zero gives
 *   a*c * sum(w) = sum(w*t) - (1 - a) * sum(w*d),
 * which is the same formula as before with weighted means in place of means:
 *   c = wmean(d) + (wmean(t) - wmean(d)) / a,   wmean(x) = sum(w*x) / sum(w).
 * All the sums are exact integers. (With every weight equal, this gives
 * exactly the same colour as computeColor.)
 */
function computeColorWeighted(picture: Picture, lines: Scanlines, alpha: number, weights: Uint16Array): RGB {
  const { target, current, width } = picture;
  let targetR = 0;
  let targetG = 0;
  let targetB = 0;
  let currentR = 0;
  let currentG = 0;
  let currentB = 0;
  let totalWeight = 0;
  for (let k = 0; k < lines.count; k++) {
    const y = lines.data[3 * k];
    const x1 = lines.data[3 * k + 1];
    const x2 = lines.data[3 * k + 2];
    for (let p = y * width + x1, end = y * width + x2; p <= end; p++) {
      const i = p * 4;
      const w = weights[p];
      targetR += w * target[i];
      targetG += w * target[i + 1];
      targetB += w * target[i + 2];
      currentR += w * current[i];
      currentG += w * current[i + 1];
      currentB += w * current[i + 2];
      totalWeight += w;
    }
  }
  if (totalWeight === 0) return [0, 0, 0];
  const scale = 255 / alpha; // 1 / a
  return [
    bestChannel(targetR, currentR, totalWeight, scale),
    bestChannel(targetG, currentG, totalWeight, scale),
    bestChannel(targetB, currentB, totalWeight, scale),
  ];
}
