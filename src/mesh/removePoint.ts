// Removing one point from a Delaunay triangulation.
//
// The triangles around the point (its "star") are deleted, leaving a
// polygonal hole whose corners are the point's neighbours. The hole is
// filled again by "ear clipping": repeatedly cut off a triangle made of
// three neighbouring corners, preferring one whose circumcircle holds no
// other corner (such a triangle belongs to the new Delaunay triangulation).
// Finally any edge that is still not Delaunay is flipped (legalize.ts).
//
// A point on the image border has an open star (half a fan); the hole is
// then closed by the border edge between its two border neighbours. The
// four image corners can never be removed.

import { legalize } from './legalize';
import { inCircle, orient } from './predicates';
import {
  allocSlot,
  detachPoint,
  freeSlot,
  link,
  nextEdge,
  prevEdge,
  pushEdge,
  setTriangle,
  type Triangulation,
} from './triangulation';

// Scratch space, reused for every removal.
let polygon = new Int32Array(64); // corner point numbers, in order round the hole
let outer = new Int32Array(64); // outer[i]: half-edge outside the hole edge polygon[i] -> polygon[i+1]
let star = new Int32Array(64); // slots of the deleted triangles

/**
 * Remove point p. Returns false, leaving the caller to undo, if p is not in
 * the mesh, is an image corner, or (should never happen) the hole could
 * not be filled.
 */
export function removePoint(tri: Triangulation, p: number): boolean {
  const { xs, ys, corners, twin } = tri;
  const start = tri.pointEdge[p];
  if (start < 0) return false;

  // Turn round p until reaching the border (or coming back to the start).
  // Half-edge h leaves p; next(twin(h)) is the next half-edge leaving p
  // going one way round, twin(prev(h)) the next going the other way.
  let first = start;
  let open = false;
  for (let guard = 0; guard <= tri.capacity; guard++) {
    const back = twin[first];
    if (back < 0) {
      open = true;
      break;
    }
    first = nextEdge(back);
    if (first === start) break;
  }

  // Collect the star and the hole polygon going the other way round.
  let starCount = 0;
  let m = 0;
  let h = first;
  for (let guard = 0; guard <= tri.capacity; guard++) {
    ensureRoom(m + 2);
    star[starCount++] = (h / 3) | 0;
    polygon[m] = corners[nextEdge(h)];
    outer[m] = twin[nextEdge(h)];
    m++;
    const forward = twin[prevEdge(h)];
    if (forward < 0) {
      // Open star: the last neighbour, then the border edge back to the first.
      polygon[m] = corners[prevEdge(h)];
      outer[m] = -1;
      m++;
      break;
    }
    h = forward;
    if (h === first) break;
  }

  if (open) {
    // p must lie on the border line between its two border neighbours;
    // otherwise it is a corner of the image, which must stay.
    const a = polygon[m - 1];
    const b = polygon[0];
    if (orient(xs[a], ys[a], xs[b], ys[b], xs[p], ys[p]) !== 0) return false;
  }
  if (m < 3) return false;

  for (let i = 0; i < starCount; i++) freeSlot(tri, star[i]);
  detachPoint(tri, p);

  // Fill the hole.
  let stackCount = 0;
  while (m > 3) {
    const i = chooseEar(tri, m);
    if (i < 0) return false;
    const ia = i === 0 ? m - 1 : i - 1;
    const ic = i === m - 1 ? 0 : i + 1;
    const t = allocSlot(tri);
    if (t < 0) return false;
    setTriangle(tri, t, polygon[ia], polygon[i], polygon[ic]);
    link(tri, 3 * t, outer[ia]);
    link(tri, 3 * t + 1, outer[i]);
    // The new edge c->a is now the outside of the hole edge a->c.
    outer[ia] = 3 * t + 2;
    for (let j = i; j < m - 1; j++) {
      polygon[j] = polygon[j + 1];
      outer[j] = outer[j + 1];
    }
    m--;
    stackCount = pushEdge(tri, stackCount, 3 * t + 2);
  }
  const a = polygon[0];
  const b = polygon[1];
  const c = polygon[2];
  if (orient(xs[a], ys[a], xs[b], ys[b], xs[c], ys[c]) <= 0) return false;
  const t = allocSlot(tri);
  if (t < 0) return false;
  setTriangle(tri, t, a, b, c);
  link(tri, 3 * t, outer[0]);
  link(tri, 3 * t + 1, outer[1]);
  link(tri, 3 * t + 2, outer[2]);

  return legalize(tri, stackCount);
}

/**
 * Pick the corner i of the hole polygon (of m corners) to cut off as the
 * triangle (corner i-1, corner i, corner i+1). It must turn the right way
 * and contain no other corner. Prefers one whose circumcircle is empty.
 * Returns -1 if there is none.
 */
function chooseEar(tri: Triangulation, m: number): number {
  const { xs, ys } = tri;
  let fallback = -1;
  for (let i = 0; i < m; i++) {
    const ia = i === 0 ? m - 1 : i - 1;
    const ic = i === m - 1 ? 0 : i + 1;
    const a = polygon[ia];
    const b = polygon[i];
    const c = polygon[ic];
    const ax = xs[a], ay = ys[a], bx = xs[b], by = ys[b], cx = xs[c], cy = ys[c];
    if (orient(ax, ay, bx, by, cx, cy) <= 0) continue;
    let isEar = true;
    let empty = true;
    for (let j = 0; j < m; j++) {
      if (j === ia || j === i || j === ic) continue;
      const vx = xs[polygon[j]];
      const vy = ys[polygon[j]];
      // Another corner inside or on the triangle: cutting it off would overlap.
      if (
        orient(ax, ay, bx, by, vx, vy) >= 0 &&
        orient(bx, by, cx, cy, vx, vy) >= 0 &&
        orient(cx, cy, ax, ay, vx, vy) >= 0
      ) {
        isEar = false;
        break;
      }
      if (empty && inCircle(ax, ay, bx, by, cx, cy, vx, vy) > 0) empty = false;
    }
    if (!isEar) continue;
    if (empty) return i;
    if (fallback < 0) fallback = i;
  }
  return fallback;
}

function ensureRoom(size: number): void {
  if (size <= polygon.length) return;
  const length = polygon.length * 2;
  const biggerPolygon = new Int32Array(length);
  const biggerOuter = new Int32Array(length);
  const biggerStar = new Int32Array(length);
  biggerPolygon.set(polygon);
  biggerOuter.set(outer);
  biggerStar.set(star);
  polygon = biggerPolygon;
  outer = biggerOuter;
  star = biggerStar;
}
