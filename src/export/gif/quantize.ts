// Maps each pixel of each frame to the index of its nearest colour in a
// palette.
//
// A brute-force "nearest colour" search checks a pixel against every
// palette entry (up to 256) and keeps the closest. Doing that for every
// pixel of several large frames is too slow (12 frames of 1024x1536 is over
// 18 million pixels, each needing up to 256 distance checks). Instead we
// precompute the answer for a coarse grid of colours once - the same 5-bits
// -per-channel grid the palette builder uses, 32768 cells - and then look a
// pixel's cell up in that table instead of searching the palette directly.
// This is approximate (a pixel's true nearest colour could in principle
// differ from its cell's), but the grid is fine enough relative to the
// palette spacing that, for this project's smooth source images, it is
// visually indistinguishable from an exact search and roughly 30x fewer
// distance comparisons in total.

import type { Bitmap } from '../../engine/types';
import type { PaletteColor } from './types';

const BUCKET_BITS = 5;
const BUCKET_SHIFT = 8 - BUCKET_BITS;
const BUCKET_LEVELS = 1 << BUCKET_BITS;

/** Builds the coarse nearest-colour lookup table described above. */
function buildNearestLut(palette: PaletteColor[]): Uint8Array {
  const lut = new Uint8Array(BUCKET_LEVELS * BUCKET_LEVELS * BUCKET_LEVELS);
  const cellSize = 1 << BUCKET_SHIFT; // width of one grid cell in 0-255 units
  let cell = 0;
  for (let ri = 0; ri < BUCKET_LEVELS; ri++) {
    const r = ri * cellSize + cellSize / 2; // use the cell's centre colour
    for (let gi = 0; gi < BUCKET_LEVELS; gi++) {
      const g = gi * cellSize + cellSize / 2;
      for (let bi = 0; bi < BUCKET_LEVELS; bi++) {
        const b = bi * cellSize + cellSize / 2;
        lut[cell++] = nearestPaletteIndexExact(palette, r, g, b);
      }
    }
  }
  return lut;
}

/** Brute-force nearest colour by squared Euclidean distance. Used only to build the LUT. */
function nearestPaletteIndexExact(palette: PaletteColor[], r: number, g: number, b: number): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const dr = palette[i].r - r;
    const dg = palette[i].g - g;
    const db = palette[i].b - b;
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

function cellIndex(r: number, g: number, b: number): number {
  const ri = r >> BUCKET_SHIFT;
  const gi = g >> BUCKET_SHIFT;
  const bi = b >> BUCKET_SHIFT;
  return (ri << (2 * BUCKET_BITS)) | (gi << BUCKET_BITS) | bi;
}

/**
 * Maps every frame's pixels to palette indices. Returns one Uint8Array of
 * width*height indices per frame, in the same order as `frames`.
 *
 * Without dithering this is a direct per-pixel lookup table hit. With
 * dithering (Floyd-Steinberg) the error between a pixel's true colour and
 * its chosen palette colour is carried, with weights 7/16, 3/16, 5/16 and
 * 1/16, onto the pixel to the right and the three pixels below it, so
 * average colour is preserved even though each pixel is forced onto one of
 * a limited set of colours - this is what breaks up visible banding in
 * smooth gradients into a less-objectionable scatter of dots.
 */
export function quantizeFrames(frames: Bitmap[], palette: PaletteColor[], dither: boolean): Uint8Array[] {
  const lut = buildNearestLut(palette);
  return frames.map((frame) => (dither ? quantizeDithered(frame, palette, lut) : quantizeFlat(frame, lut)));
}

function quantizeFlat(frame: Bitmap, lut: Uint8Array): Uint8Array {
  const { width, height, data } = frame;
  const indices = new Uint8Array(width * height);
  for (let p = 0, i = 0; p < indices.length; p++, i += 4) {
    indices[p] = lut[cellIndex(data[i], data[i + 1], data[i + 2])];
  }
  return indices;
}

function quantizeDithered(frame: Bitmap, palette: PaletteColor[], lut: Uint8Array): Uint8Array {
  const { width, height, data } = frame;
  const indices = new Uint8Array(width * height);
  // Working copy of the colour plane we can push error into, one row ahead
  // kept in full precision (as plain numbers, which can go slightly outside
  // 0-255 while error is pending; we clamp before each lookup).
  const r = new Float32Array(width * height);
  const g = new Float32Array(width * height);
  const b = new Float32Array(width * height);
  for (let p = 0, i = 0; p < r.length; p++, i += 4) {
    r[p] = data[i];
    g[p] = data[i + 1];
    b[p] = data[i + 2];
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      const cr = clamp255(r[p]);
      const cg = clamp255(g[p]);
      const cb = clamp255(b[p]);
      const idx = lut[cellIndex(cr, cg, cb)];
      indices[p] = idx;
      const chosen = palette[idx];
      const er = cr - chosen.r;
      const eg = cg - chosen.g;
      const eb = cb - chosen.b;

      // Floyd-Steinberg distributes the error to not-yet-visited neighbours.
      if (x + 1 < width) diffuse(r, g, b, p + 1, er, eg, eb, 7 / 16);
      if (y + 1 < height) {
        if (x > 0) diffuse(r, g, b, p + width - 1, er, eg, eb, 3 / 16);
        diffuse(r, g, b, p + width, er, eg, eb, 5 / 16);
        if (x + 1 < width) diffuse(r, g, b, p + width + 1, er, eg, eb, 1 / 16);
      }
    }
  }
  return indices;
}

function diffuse(
  r: Float32Array,
  g: Float32Array,
  b: Float32Array,
  p: number,
  er: number,
  eg: number,
  eb: number,
  weight: number,
): void {
  r[p] += er * weight;
  g[p] += eg * weight;
  b[p] += eb * weight;
}

function clamp255(v: number): number {
  if (v < 0) return 0;
  if (v > 255) return 255;
  return Math.round(v);
}
