// A coarse map of where the picture is currently worst, used to place some
// random candidate shapes where they are most likely to help (the idea comes
// from primeval's error_grid.rs).
//
// The image is cut into square cells. Each cell's weight is its summed
// squared error (each pixel's multiplied by its weight, if there are weights). To sample, pick a cell with probability proportional to its
// weight, then a uniform point inside it.

import type { Picture } from './picture';
import type { Rng } from './rng';

/** About this many cells along the image's longest side. */
const CELLS_ALONG_LONGEST_SIDE = 16;

export interface ErrorGrid {
  cellSize: number;
  cols: number;
  rows: number;
  /** cumulative[i] = summed error of cells 0..i (row by row). */
  cumulative: Float64Array;
}

export function computeErrorGrid(picture: Picture): ErrorGrid {
  const { width, height, target, current, weights } = picture;
  const cellSize = Math.max(1, Math.ceil(Math.max(width, height) / CELLS_ALONG_LONGEST_SIDE));
  const cols = Math.ceil(width / cellSize);
  const rows = Math.ceil(height / cellSize);
  const errors = new Float64Array(cols * rows);
  for (let y = 0; y < height; y++) {
    const rowBase = Math.floor(y / cellSize) * cols;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const dr = target[i] - current[i];
      const dg = target[i + 1] - current[i + 1];
      const db = target[i + 2] - current[i + 2];
      const error = dr * dr + dg * dg + db * db;
      errors[rowBase + Math.floor(x / cellSize)] += weights ? weights[y * width + x] * error : error;
    }
  }
  const cumulative = new Float64Array(cols * rows);
  let running = 0;
  for (let i = 0; i < errors.length; i++) {
    running += errors[i];
    cumulative[i] = running;
  }
  return { cellSize, cols, rows, cumulative };
}

/**
 * A random point, more likely where the error is high. Falls back to a
 * uniform point if the picture is already perfect.
 */
export function sampleErrorGrid(grid: ErrorGrid, rng: Rng, width: number, height: number): [number, number] {
  const total = grid.cumulative[grid.cumulative.length - 1];
  if (!(total > 0)) return [rng.next() * width, rng.next() * height];

  // Binary search for the first cell whose cumulative error exceeds r.
  const r = rng.next() * total;
  let low = 0;
  let high = grid.cumulative.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (grid.cumulative[mid] > r) high = mid;
    else low = mid + 1;
  }
  const col = low % grid.cols;
  const row = Math.floor(low / grid.cols);
  // A uniform point inside the cell. Cells in the last column and row are
  // narrower when the image size is not a multiple of the cell size, so use
  // each cell's real extent (otherwise points would pile up on the edge).
  const left = col * grid.cellSize;
  const top = row * grid.cellSize;
  const x = left + rng.next() * Math.min(grid.cellSize, width - left);
  const y = top + rng.next() * Math.min(grid.cellSize, height - top);
  return [x, y];
}
