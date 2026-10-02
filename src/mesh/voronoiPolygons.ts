// The outline of each point's cell, for drawing: the image rectangle cut
// down by one straight line per neighbour (the perpendicular bisector of
// the point and that neighbour, keeping the side nearer the point). A
// Voronoi cell is decided by the Delaunay neighbours alone, so this is the
// exact cell, clipped to the image.
//
// The corners are decimals; they are rounded to 1/100 pixel, which is
// invisible at any export size and keeps files small. Scoring does not use
// these outlines; it uses the pixel rule in cells.ts, which matches them
// except exactly on a boundary.

import { collectNeighbours } from './neighbours';
import type { Triangulation } from './triangulation';

const scratch = { list: new Int32Array(32) };

/** The clipped cell of point p, clockwise on screen, corners rounded to 0.01 px. */
export function cellOutline(tri: Triangulation, p: number, width: number, height: number): Array<[number, number]> {
  const { xs, ys } = tri;
  let polygon: Array<[number, number]> = [[0, 0], [width, 0], [width, height], [0, height]];
  const count = collectNeighbours(tri, p, scratch);
  const px = xs[p];
  const py = ys[p];
  for (let i = 0; i < count && polygon.length > 0; i++) {
    const q = scratch.list[i];
    // Keep X with  2 (q - p) . X <= |q|^2 - |p|^2  (X at least as near p as q).
    const nx = 2 * (xs[q] - px);
    const ny = 2 * (ys[q] - py);
    const limit = xs[q] * xs[q] + ys[q] * ys[q] - px * px - py * py;
    polygon = clipByHalfPlane(polygon, nx, ny, limit);
  }
  const rounded: Array<[number, number]> = [];
  for (const [x, y] of polygon) {
    const vertex: [number, number] = [Math.round(x * 100) / 100, Math.round(y * 100) / 100];
    const last = rounded[rounded.length - 1];
    if (!last || last[0] !== vertex[0] || last[1] !== vertex[1]) rounded.push(vertex);
  }
  while (rounded.length > 1 && rounded[0][0] === rounded[rounded.length - 1][0] && rounded[0][1] === rounded[rounded.length - 1][1]) {
    rounded.pop();
  }
  return rounded;
}

/** One step of Sutherland-Hodgman clipping: keep the part of the convex polygon with nx*x + ny*y <= limit. */
function clipByHalfPlane(
  polygon: Array<[number, number]>,
  nx: number,
  ny: number,
  limit: number,
): Array<[number, number]> {
  const result: Array<[number, number]> = [];
  for (let i = 0; i < polygon.length; i++) {
    const [ax, ay] = polygon[i];
    const [bx, by] = polygon[(i + 1) % polygon.length];
    const sideA = nx * ax + ny * ay - limit;
    const sideB = nx * bx + ny * by - limit;
    if (sideA <= 0) result.push([ax, ay]);
    if ((sideA < 0 && sideB > 0) || (sideA > 0 && sideB < 0)) {
      const t = sideA / (sideA - sideB);
      result.push([ax + t * (bx - ax), ay + t * (by - ay)]);
    }
  }
  return result;
}
