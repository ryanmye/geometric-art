// Positions on the image border, measured as a distance along it.
//
// Going clockwise on screen from the top-left corner: the top edge is
// 0 .. width, the right edge width .. width+height, the bottom edge
// width+height .. 2*width+height (right to left), and the left edge
// 2*width+height .. 2*(width+height) (bottom to top). The four corners are
// at 0, width, width+height and 2*width+height. Border points slide along
// this loop, so they can move from one side to the next past a corner.

export function perimeter(width: number, height: number): number {
  return 2 * (width + height);
}

export function isCornerPosition(s: number, width: number, height: number): boolean {
  return s === 0 || s === width || s === width + height || s === 2 * width + height;
}

/** Border position of point (x, y), which must be on the border. */
export function borderPosition(x: number, y: number, width: number, height: number): number {
  if (y === 0) return x;
  if (x === width) return width + y;
  if (y === height) return 2 * width + height - x;
  return 2 * width + 2 * height - y; // x === 0
}

/** Write the point at border position s (0 <= s < perimeter) into out[0], out[1]. */
export function borderPoint(s: number, width: number, height: number, out: Int32Array): void {
  if (s <= width) {
    out[0] = s;
    out[1] = 0;
  } else if (s <= width + height) {
    out[0] = width;
    out[1] = s - width;
  } else if (s <= 2 * width + height) {
    out[0] = 2 * width + height - s;
    out[1] = height;
  } else {
    out[0] = 0;
    out[1] = 2 * width + 2 * height - s;
  }
}
