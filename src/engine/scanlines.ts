// A shape's coverage as horizontal runs of pixels, one run per row.
//
// All five shapes are convex, so each row of pixels meets a shape in at most
// one run. A run is stored as three integers in a flat array:
//   data[3*i]     = y   (pixel row)
//   data[3*i + 1] = x1  (first covered pixel in that row)
//   data[3*i + 2] = x2  (last covered pixel, inclusive)
// Runs are already clipped to the image, so 0 <= x1 <= x2 < width.
// The buffer is reused for every shape to avoid allocating in the hot loop.

export interface Scanlines {
  /** Number of runs currently stored. */
  count: number;
  data: Int32Array;
}

export function createScanlines(height: number): Scanlines {
  return { count: 0, data: new Int32Array(height * 3) };
}

/**
 * Record the pixels of row `y` whose centres lie in [left, right] (in image
 * coordinates), clipped to the image. Pixel px has its centre at px + 0.5,
 * so it is covered when left <= px + 0.5 <= right.
 */
export function addSpan(lines: Scanlines, y: number, left: number, right: number, width: number): void {
  let x1 = Math.ceil(left - 0.5);
  let x2 = Math.floor(right - 0.5);
  if (x1 < 0) x1 = 0;
  if (x2 > width - 1) x2 = width - 1;
  if (x1 > x2) return;
  const i = lines.count * 3;
  lines.data[i] = y;
  lines.data[i + 1] = x1;
  lines.data[i + 2] = x2;
  lines.count++;
}

/** Range of pixel rows whose centres lie in [top, bottom], clipped to the image. */
export function rowRange(top: number, bottom: number, height: number): [number, number] {
  let first = Math.ceil(top - 0.5);
  let last = Math.floor(bottom - 0.5);
  if (first < 0) first = 0;
  if (last > height - 1) last = height - 1;
  return [first, last];
}

/** Number of pixels covered by the runs. */
export function pixelCount(lines: Scanlines): number {
  let total = 0;
  for (let i = 0; i < lines.count; i++) {
    total += lines.data[3 * i + 2] - lines.data[3 * i + 1] + 1;
  }
  return total;
}
