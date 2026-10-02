import { addSpan, rowRange, type Scanlines } from '../scanlines';

/**
 * Rasterize a convex polygon (used for triangles and rotated rectangles).
 * `points` holds x0, y0, x1, y1, ... for `cornerCount` corners in order.
 *
 * For each pixel row we take the horizontal line through the row's pixel
 * centres (y = row + 0.5), find where it crosses the polygon's edges, and
 * cover the pixels whose centres fall between the leftmost and rightmost
 * crossing. Because the polygon is convex, that is exactly the inside.
 */
export function rasterizeConvexPolygon(
  points: ArrayLike<number>,
  cornerCount: number,
  lines: Scanlines,
  width: number,
  height: number,
): void {
  lines.count = 0;

  let top = Infinity;
  let bottom = -Infinity;
  for (let i = 0; i < cornerCount; i++) {
    const y = points[2 * i + 1];
    if (y < top) top = y;
    if (y > bottom) bottom = y;
  }
  const [firstRow, lastRow] = rowRange(top, bottom, height);

  for (let row = firstRow; row <= lastRow; row++) {
    const yc = row + 0.5;
    let left = Infinity;
    let right = -Infinity;
    for (let i = 0; i < cornerCount; i++) {
      const j = (i + 1) % cornerCount;
      const xa = points[2 * i];
      const ya = points[2 * i + 1];
      const xb = points[2 * j];
      const yb = points[2 * j + 1];
      // Skip edges that do not reach this row.
      if ((ya < yc && yb < yc) || (ya > yc && yb > yc)) continue;
      if (ya === yb) {
        // A horizontal edge lying exactly on the row: both ends count.
        left = Math.min(left, xa, xb);
        right = Math.max(right, xa, xb);
        continue;
      }
      const x = xa + ((yc - ya) * (xb - xa)) / (yb - ya);
      if (x < left) left = x;
      if (x > right) right = x;
    }
    if (left <= right) addSpan(lines, row, left, right, width);
  }
}
