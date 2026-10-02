// The two geometric tests a Delaunay triangulation needs.
//
// All mesh points have integer coordinates between 0 and 4096, so every
// product below is an integer smaller than 2^53 and is computed exactly by
// ordinary JavaScript numbers. That makes both tests exact: no rounding
// error can make the triangulation inconsistent, which is the usual source
// of crashes in triangulation code.

/**
 * Twice the signed area of triangle (a, b, c).
 * > 0: a, b, c turn clockwise on screen (y down), which is the orientation
 *      every mesh triangle is stored in;
 * < 0: anticlockwise; 0: the three points are on one line.
 */
export function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/**
 * For a triangle (a, b, c) with orient > 0: > 0 when d is strictly inside
 * the circle through a, b and c, 0 when on it, < 0 when outside.
 * (The standard 3x3 "in-circle" determinant, with d moved to the origin.)
 */
export function inCircle(
  ax: number, ay: number,
  bx: number, by: number,
  cx: number, cy: number,
  dx: number, dy: number,
): number {
  const adx = ax - dx;
  const ady = ay - dy;
  const bdx = bx - dx;
  const bdy = by - dy;
  const cdx = cx - dx;
  const cdy = cy - dy;
  const aLift = adx * adx + ady * ady;
  const bLift = bdx * bdx + bdy * bdy;
  const cLift = cdx * cdx + cdy * cdy;
  return (
    aLift * (bdx * cdy - bdy * cdx) +
    bLift * (cdx * ady - cdy * adx) +
    cLift * (adx * bdy - ady * bdx)
  );
}

/** Largest width or height for which the tests above are exact. */
export const MAX_MESH_SIZE = 4096;
