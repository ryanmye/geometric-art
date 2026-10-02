// Where the points start.
//
// Point order: 0-3 the image corners, then the border points, then the
// interior points. Border points are spread evenly along the border.
// Interior points are drawn at random, more often where the picture has
// edges (a large brightness gradient), and, when the run has per-pixel
// weights, more often where the weights are high, so the optimiser starts
// with detail roughly where it is needed. All arithmetic here is on whole numbers or
// comes from the seeded generator, so it is identical everywhere.

import type { Bitmap } from '../engine/types';
import type { Rng } from '../engine/rng';
import { borderPoint, isCornerPosition, perimeter } from './border';

export interface PointLayout {
  xs: Int32Array;
  ys: Int32Array;
  /** Points borderStart .. interiorStart-1 are on the border (borderStart is always 4). */
  borderStart: number;
  interiorStart: number;
}

/** How many of `points` go on the border. */
export function borderPointCount(points: number, borderDensity: number, width: number, height: number): number {
  // Average distance between neighbouring points if spread evenly.
  const spacing = Math.sqrt((width * height) / points);
  let count = Math.round((borderDensity * perimeter(width, height)) / spacing);
  const borderRoom = 2 * (width - 1) + 2 * (height - 1);
  const interiorRoom = (width - 1) * (height - 1);
  count = Math.max(count, points - 4 - interiorRoom);
  count = Math.min(count, points - 4, borderRoom);
  return Math.max(0, count);
}

export function initialPoints(
  target: Bitmap,
  points: number,
  borderDensity: number,
  rng: Rng,
  weights: Uint16Array | null = null,
): PointLayout {
  const { width, height } = target;
  const xs = new Int32Array(points);
  const ys = new Int32Array(points);
  const taken = new Uint8Array((width + 1) * (height + 1));
  const place = (i: number, x: number, y: number) => {
    xs[i] = x;
    ys[i] = y;
    taken[y * (width + 1) + x] = 1;
  };

  place(0, 0, 0);
  place(1, width, 0);
  place(2, width, height);
  place(3, 0, height);

  // Border: evenly spaced, skipping corners and taken spots.
  const borderCount = borderPointCount(points, borderDensity, width, height);
  const loop = perimeter(width, height);
  const spot = new Int32Array(2);
  for (let k = 0; k < borderCount; k++) {
    let s = Math.floor(((2 * k + 1) * loop) / (2 * borderCount));
    for (;;) {
      borderPoint(s, width, height, spot);
      if (!isCornerPosition(s, width, height) && !taken[spot[1] * (width + 1) + spot[0]]) break;
      s = (s + 1) % loop;
    }
    place(4 + k, spot[0], spot[1]);
  }

  // Interior: weighted by edge strength.
  const interiorStart = 4 + borderCount;
  const cumulative = edgeWeights(target, weights);
  const total = cumulative[cumulative.length - 1];
  for (let i = interiorStart; i < points; i++) {
    let placed = false;
    for (let attempt = 0; attempt < 50 && !placed; attempt++) {
      const pixel = pickWeighted(cumulative, rng.next() * total);
      const px = pixel % width;
      const py = (pixel - px) / width;
      // A pixel spans [px, px+1] x [py, py+1]; take one of its corners, inside the image.
      const x = clamp(px + rng.int(0, 1), 1, width - 1);
      const y = clamp(py + rng.int(0, 1), 1, height - 1);
      if (!taken[y * (width + 1) + x]) {
        place(i, x, y);
        placed = true;
      }
    }
    if (!placed) {
      // Very crowded: take the first free interior spot.
      for (let y = 1; y < height && !placed; y++) {
        for (let x = 1; x < width && !placed; x++) {
          if (!taken[y * (width + 1) + x]) {
            place(i, x, y);
            placed = true;
          }
        }
      }
    }
  }
  return { xs, ys, borderStart: 4, interiorStart };
}

/**
 * Running total of per-pixel weights: brightness gradient plus the average
 * gradient, so flat areas still get some points, times the run's pixel
 * weight if it has them. Brightness is the whole number 2R + 5G + B
 * (roughly how bright the eye finds it). All whole numbers, so exact.
 */
function edgeWeights(target: Bitmap, weights: Uint16Array | null): Float64Array {
  const { width, height, data } = target;
  const light = new Int32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    light[i] = 2 * data[4 * i] + 5 * data[4 * i + 1] + data[4 * i + 2];
  }
  const gradient = new Int32Array(width * height);
  let sum = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const left = light[y * width + (x > 0 ? x - 1 : x)];
      const right = light[y * width + (x < width - 1 ? x + 1 : x)];
      const up = light[(y > 0 ? y - 1 : y) * width + x];
      const down = light[(y < height - 1 ? y + 1 : y) * width + x];
      const g = Math.abs(right - left) + Math.abs(down - up);
      gradient[y * width + x] = g;
      sum += g;
    }
  }
  const base = Math.floor(sum / (width * height)) + 1;
  const cumulative = new Float64Array(width * height);
  let running = 0;
  for (let i = 0; i < width * height; i++) {
    running += weights ? (gradient[i] + base) * weights[i] : gradient[i] + base;
    cumulative[i] = running;
  }
  return cumulative;
}

/** Index of the first entry of `cumulative` greater than `value` (binary search). */
function pickWeighted(cumulative: Float64Array, value: number): number {
  let low = 0;
  let high = cumulative.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (cumulative[mid] > value) high = mid;
    else low = mid + 1;
  }
  return low;
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}
