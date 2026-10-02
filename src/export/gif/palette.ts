// Builds a colour palette (a "colour table" in GIF terms) for a set of
// frames, using a median-cut-style algorithm.
//
// Median cut: start with one "box" holding every colour in the image(s).
// Repeatedly pick the box with the biggest population and split it in two
// along whichever channel (R, G or B) has the widest range, cutting at the
// weighted median so each half gets about the same number of pixels. Stop
// once there are as many boxes as colours wanted. Each box becomes one
// palette entry: the average colour of everything inside it.
//
// Running median cut over every pixel of a 1024x1536 x 12-frame animation
// would mean sorting tens of millions of values. Instead we first bucket
// colours into a coarse 3D histogram (5 bits per channel = 32 levels per
// channel, 32*32*32 = 32768 buckets) and run median cut over the buckets,
// weighted by how many pixels fell in each one. This loses a little colour
// precision (at most +-4 per channel before averaging) but is fast and, for
// the smooth, flat-shape pictures this project renders, visually
// indistinguishable from an exact median cut.

import type { Bitmap } from '../../engine/types';
import type { PaletteColor } from './types';

const BUCKET_BITS = 5; // bits per channel kept in the coarse histogram
const BUCKET_SHIFT = 8 - BUCKET_BITS; // drop this many low bits of each 0-255 channel

/** One coarse histogram bucket: population and summed colour (for averaging). */
interface Bucket {
  count: number;
  sumR: number;
  sumG: number;
  sumB: number;
  r: number; // representative colour = sum / count, filled in once at the end
  g: number;
  b: number;
}

/** A median-cut box: a set of buckets (by index into `buckets`) plus running totals. */
interface Box {
  bucketIndices: number[];
  count: number;
  sumR: number;
  sumG: number;
  sumB: number;
  minR: number;
  maxR: number;
  minG: number;
  maxG: number;
  minB: number;
  maxB: number;
}

/** Builds the coarse histogram described above from every pixel of every frame. */
function buildHistogram(frames: Bitmap[]): Map<number, Bucket> {
  const histogram = new Map<number, Bucket>();
  for (const frame of frames) {
    const data = frame.data;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const key =
        ((r >> BUCKET_SHIFT) << (2 * BUCKET_BITS)) |
        ((g >> BUCKET_SHIFT) << BUCKET_BITS) |
        (b >> BUCKET_SHIFT);
      let bucket = histogram.get(key);
      if (!bucket) {
        bucket = { count: 0, sumR: 0, sumG: 0, sumB: 0, r: 0, g: 0, b: 0 };
        histogram.set(key, bucket);
      }
      bucket.count++;
      bucket.sumR += r;
      bucket.sumG += g;
      bucket.sumB += b;
    }
  }
  for (const bucket of histogram.values()) {
    bucket.r = bucket.sumR / bucket.count;
    bucket.g = bucket.sumG / bucket.count;
    bucket.b = bucket.sumB / bucket.count;
  }
  return histogram;
}

function makeBox(buckets: Bucket[], bucketIndices: number[]): Box {
  let count = 0;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let minR = 255;
  let maxR = 0;
  let minG = 255;
  let maxG = 0;
  let minB = 255;
  let maxB = 0;
  for (const idx of bucketIndices) {
    const bucket = buckets[idx];
    count += bucket.count;
    sumR += bucket.sumR;
    sumG += bucket.sumG;
    sumB += bucket.sumB;
    if (bucket.r < minR) minR = bucket.r;
    if (bucket.r > maxR) maxR = bucket.r;
    if (bucket.g < minG) minG = bucket.g;
    if (bucket.g > maxG) maxG = bucket.g;
    if (bucket.b < minB) minB = bucket.b;
    if (bucket.b > maxB) maxB = bucket.b;
  }
  return { bucketIndices, count, sumR, sumG, sumB, minR, maxR, minG, maxG, minB, maxB };
}

/** Splits a box into two along its widest channel, at the weighted median. */
function splitBox(box: Box, buckets: Bucket[]): [Box, Box] | null {
  const rangeR = box.maxR - box.minR;
  const rangeG = box.maxG - box.minG;
  const rangeB = box.maxB - box.minB;
  const widest = Math.max(rangeR, rangeG, rangeB);
  if (widest === 0 || box.bucketIndices.length < 2) return null; // can't split a single colour

  let channel: 'r' | 'g' | 'b';
  if (widest === rangeR) channel = 'r';
  else if (widest === rangeG) channel = 'g';
  else channel = 'b';

  const sorted = box.bucketIndices.slice().sort((a, b) => buckets[a][channel] - buckets[b][channel]);
  const half = box.count / 2;
  let running = 0;
  let cut = sorted.length - 1; // fallback: everything but the last bucket in the first half
  for (let i = 0; i < sorted.length; i++) {
    running += buckets[sorted[i]].count;
    if (running >= half) {
      cut = i;
      break;
    }
  }
  // Make sure both halves are non-empty.
  if (cut === sorted.length - 1) cut = sorted.length - 2;
  if (cut < 0) return null;

  const left = sorted.slice(0, cut + 1);
  const right = sorted.slice(cut + 1);
  if (left.length === 0 || right.length === 0) return null;
  return [makeBox(buckets, left), makeBox(buckets, right)];
}

/**
 * Builds a palette of at most `maxColors` colours from every pixel of
 * `frames` (alpha is ignored). Always returns at least one colour.
 */
export function buildPalette(frames: Bitmap[], maxColors: number): PaletteColor[] {
  const histogram = buildHistogram(frames);
  const buckets = Array.from(histogram.values());

  if (buckets.length === 0) return [{ r: 0, g: 0, b: 0 }];
  if (buckets.length <= maxColors) {
    // Few enough distinct coarse colours that every bucket can be its own
    // palette entry; no need to split anything.
    return buckets.map((bucket) => ({
      r: Math.round(bucket.r),
      g: Math.round(bucket.g),
      b: Math.round(bucket.b),
    }));
  }

  const allIndices = buckets.map((_, i) => i);
  const boxes: Box[] = [makeBox(buckets, allIndices)];

  while (boxes.length < maxColors) {
    // Split the biggest (by pixel population) splittable box.
    boxes.sort((a, b) => b.count - a.count);
    let splitAt = -1;
    let result: [Box, Box] | null = null;
    for (let i = 0; i < boxes.length; i++) {
      result = splitBox(boxes[i], buckets);
      if (result) {
        splitAt = i;
        break;
      }
    }
    if (splitAt === -1 || !result) break; // nothing left that can be split
    boxes.splice(splitAt, 1, result[0], result[1]);
  }

  return boxes.map((box) => ({
    r: Math.round(box.sumR / box.count),
    g: Math.round(box.sumG / box.count),
    b: Math.round(box.sumB / box.count),
  }));
}
