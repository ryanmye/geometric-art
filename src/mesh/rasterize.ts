// Which pixels a triangle covers.
//
// A pixel (px, py) belongs to a triangle when its centre (px + 0.5,
// py + 0.5) is inside. Mesh points have integer coordinates, so a pixel
// centre's y (always n + 0.5) is never level with a vertex, and each row of
// centres crosses a triangle between exactly two of its edges, at x = left
// and x = right. The triangle gets the centres with left <= x < right.
//
// The crossing point of an edge is computed by edgeX(), always from the
// edge's upper end, so both triangles beside an edge get exactly the same
// number for it. One takes the centres before it (x < value) and the other
// the centres from it on (x >= value), so every pixel of the image belongs
// to exactly one triangle: no gaps, no overlaps, even with rounding.

/**
 * Write the covered pixels of triangle (a, b, c) into `out` as runs:
 * out[3i] = row, out[3i+1] = first pixel, out[3i+2] = last pixel (inclusive),
 * clipped to the image. `out` needs 3 * height entries. Returns the run count.
 */
export function triangleSpans(
  ax: number, ay: number,
  bx: number, by: number,
  cx: number, cy: number,
  width: number, height: number,
  out: Int32Array,
): number {
  // Sort the corners top to bottom: (x0,y0) highest, (x2,y2) lowest.
  let x0 = ax, y0 = ay, x1 = bx, y1 = by, x2 = cx, y2 = cy, swapX = 0, swapY = 0;
  if (y1 < y0) { swapX = x0; swapY = y0; x0 = x1; y0 = y1; x1 = swapX; y1 = swapY; }
  if (y2 < y1) { swapX = x1; swapY = y1; x1 = x2; y1 = y2; x2 = swapX; y2 = swapY; }
  if (y1 < y0) { swapX = x0; swapY = y0; x0 = x1; y0 = y1; x1 = swapX; y1 = swapY; }

  // Rows whose centre py + 0.5 lies strictly between y0 and y2.
  let firstRow = Math.ceil(y0 - 0.5);
  let lastRow = Math.ceil(y2 - 0.5) - 1;
  if (firstRow < 0) firstRow = 0;
  if (lastRow > height - 1) lastRow = height - 1;

  let count = 0;
  for (let row = firstRow; row <= lastRow; row++) {
    const y = row + 0.5;
    // The long edge spans every row; the short one is the upper or lower edge.
    const longX = edgeX(x0, y0, x2, y2, y);
    const shortX = y < y1 ? edgeX(x0, y0, x1, y1, y) : edgeX(x1, y1, x2, y2, y);
    const left = longX < shortX ? longX : shortX;
    const right = longX < shortX ? shortX : longX;
    let first = Math.ceil(left - 0.5); // first centre with x >= left
    let last = Math.ceil(right - 0.5) - 1; // last centre with x < right
    if (first < 0) first = 0;
    if (last > width - 1) last = width - 1;
    if (first > last) continue;
    out[3 * count] = row;
    out[3 * count + 1] = first;
    out[3 * count + 2] = last;
    count++;
  }
  return count;
}

/** x where the edge from (xTop, yTop) down to (xBottom, yBottom) crosses height y. */
function edgeX(xTop: number, yTop: number, xBottom: number, yBottom: number, y: number): number {
  return xTop + ((y - yTop) * (xBottom - xTop)) / (yBottom - yTop);
}
