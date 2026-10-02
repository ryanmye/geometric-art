// Adding one point to a Delaunay triangulation.
//
// 1. Find the triangle containing the point by walking from a nearby
//    triangle towards it.
// 2. Split that triangle into three (or, if the point is exactly on an
//    edge, split the two triangles beside the edge into four; on a border
//    edge there is only one triangle, which becomes two).
// 3. Flip edges until the triangulation is Delaunay again (legalize.ts).

import { legalize } from './legalize';
import { orient } from './predicates';
import {
  allocSlot,
  link,
  nextEdge,
  prevEdge,
  pushEdge,
  setTriangle,
  type Triangulation,
} from './triangulation';

/**
 * Insert point p (its coordinates are already in tri.xs / tri.ys), starting
 * the search at slot `hint` (any slot; a nearby one is fastest).
 * Returns false, leaving the caller to undo, if p is outside the image or
 * exactly on an existing point.
 */
export function insertPoint(tri: Triangulation, p: number, hint: number): boolean {
  const found = locate(tri, p, hint);
  if (found < 0) return false;
  const t = found >> 2; // slot
  const where = found & 3; // 3: inside, 0-2: on that edge of the triangle

  if (where === 3) return splitTriangle(tri, t, p);
  return splitEdge(tri, 3 * t + where, p);
}

/**
 * Find the triangle containing point p. Returns 4 * slot + where, with
 * `where` 3 if p is strictly inside, or 0-2 if p is on that edge; -1 if p
 * is outside the mesh or on a vertex.
 */
function locate(tri: Triangulation, p: number, hint: number): number {
  const { xs, ys, corners, twin } = tri;
  const px = xs[p];
  const py = ys[p];
  let t = hint >= 0 && hint < tri.capacity && tri.alive[hint] ? hint : firstAlive(tri);
  if (t < 0) return -1;

  // Walk: if p is on the outer side of an edge, step across it. In a
  // Delaunay triangulation this walk never goes round in circles; the step
  // limit is only a safety net, after which every triangle is checked.
  for (let steps = 0; steps <= tri.capacity; steps++) {
    const h = 3 * t;
    const a = corners[h];
    const b = corners[h + 1];
    const c = corners[h + 2];
    const o0 = orient(xs[a], ys[a], xs[b], ys[b], px, py);
    const o1 = orient(xs[b], ys[b], xs[c], ys[c], px, py);
    const o2 = orient(xs[c], ys[c], xs[a], ys[a], px, py);
    let across = -1;
    if (o0 < 0) across = h;
    else if (o1 < 0) across = h + 1;
    else if (o2 < 0) across = h + 2;
    if (across < 0) return classify(t, o0, o1, o2);
    const next = twin[across];
    if (next < 0) return -1; // outside the image
    t = (next / 3) | 0;
  }
  return locateByScan(tri, px, py);
}

/** Slow fallback: test every triangle. */
function locateByScan(tri: Triangulation, px: number, py: number): number {
  const { xs, ys, corners } = tri;
  for (let t = 0; t < tri.capacity; t++) {
    if (!tri.alive[t]) continue;
    const a = corners[3 * t];
    const b = corners[3 * t + 1];
    const c = corners[3 * t + 2];
    const o0 = orient(xs[a], ys[a], xs[b], ys[b], px, py);
    const o1 = orient(xs[b], ys[b], xs[c], ys[c], px, py);
    const o2 = orient(xs[c], ys[c], xs[a], ys[a], px, py);
    if (o0 >= 0 && o1 >= 0 && o2 >= 0) return classify(t, o0, o1, o2);
  }
  return -1;
}

function classify(t: number, o0: number, o1: number, o2: number): number {
  const zeros = (o0 === 0 ? 1 : 0) + (o1 === 0 ? 1 : 0) + (o2 === 0 ? 1 : 0);
  if (zeros === 0) return 4 * t + 3;
  if (zeros > 1) return -1; // on a vertex: the point is already there
  if (o0 === 0) return 4 * t;
  if (o1 === 0) return 4 * t + 1;
  return 4 * t + 2;
}

function firstAlive(tri: Triangulation): number {
  for (let t = 0; t < tri.capacity; t++) if (tri.alive[t]) return t;
  return -1;
}

/** p is strictly inside triangle t = (a, b, c): replace it by (a, b, p), (b, c, p), (c, a, p). */
function splitTriangle(tri: Triangulation, t: number, p: number): boolean {
  const h = 3 * t;
  const a = tri.corners[h];
  const b = tri.corners[h + 1];
  const c = tri.corners[h + 2];
  const outAB = tri.twin[h];
  const outBC = tri.twin[h + 1];
  const outCA = tri.twin[h + 2];
  const t1 = allocSlot(tri);
  const t2 = allocSlot(tri);
  if (t1 < 0 || t2 < 0) return false;

  setTriangle(tri, t, a, b, p);
  setTriangle(tri, t1, b, c, p);
  setTriangle(tri, t2, c, a, p);
  link(tri, 3 * t, outAB);
  link(tri, 3 * t1, outBC);
  link(tri, 3 * t2, outCA);
  link(tri, 3 * t + 1, 3 * t1 + 2); // b-p
  link(tri, 3 * t1 + 1, 3 * t2 + 2); // c-p
  link(tri, 3 * t2 + 1, 3 * t + 2); // a-p

  let count = 0;
  count = pushEdge(tri, count, 3 * t);
  count = pushEdge(tri, count, 3 * t1);
  count = pushEdge(tri, count, 3 * t2);
  return legalize(tri, count);
}

/** p lies on half-edge h = a->b of triangle (a, b, c). */
function splitEdge(tri: Triangulation, h: number, p: number): boolean {
  const t = (h / 3) | 0;
  const a = tri.corners[h];
  const b = tri.corners[nextEdge(h)];
  const c = tri.corners[prevEdge(h)];
  const outBC = tri.twin[nextEdge(h)];
  const outCA = tri.twin[prevEdge(h)];
  const ht = tri.twin[h];

  if (ht < 0) {
    // Border edge: (a, b, c) becomes (a, p, c) and (p, b, c).
    const t1 = allocSlot(tri);
    if (t1 < 0) return false;
    setTriangle(tri, t, a, p, c);
    setTriangle(tri, t1, p, b, c);
    link(tri, 3 * t, -1);
    link(tri, 3 * t + 1, 3 * t1 + 2); // p-c
    link(tri, 3 * t + 2, outCA);
    link(tri, 3 * t1, -1);
    link(tri, 3 * t1 + 1, outBC);
    let count = 0;
    count = pushEdge(tri, count, 3 * t + 2);
    count = pushEdge(tri, count, 3 * t1 + 1);
    return legalize(tri, count);
  }

  // Interior edge, with triangle (b, a, d) on the other side: four triangles
  // (a, p, c), (p, b, c), (b, p, d), (p, a, d).
  const u = (ht / 3) | 0;
  const d = tri.corners[prevEdge(ht)];
  const outAD = tri.twin[nextEdge(ht)];
  const outDB = tri.twin[prevEdge(ht)];
  const t1 = allocSlot(tri);
  const t3 = allocSlot(tri);
  if (t1 < 0 || t3 < 0) return false;

  setTriangle(tri, t, a, p, c);
  setTriangle(tri, t1, p, b, c);
  setTriangle(tri, u, b, p, d);
  setTriangle(tri, t3, p, a, d);
  link(tri, 3 * t, 3 * t3); // a-p
  link(tri, 3 * t + 1, 3 * t1 + 2); // p-c
  link(tri, 3 * t + 2, outCA);
  link(tri, 3 * t1, 3 * u); // p-b
  link(tri, 3 * t1 + 1, outBC);
  link(tri, 3 * u + 1, 3 * t3 + 2); // p-d
  link(tri, 3 * u + 2, outDB);
  link(tri, 3 * t3 + 1, outAD);

  let count = 0;
  count = pushEdge(tri, count, 3 * t + 2);
  count = pushEdge(tri, count, 3 * t1 + 1);
  count = pushEdge(tri, count, 3 * u + 2);
  count = pushEdge(tri, count, 3 * t3 + 1);
  return legalize(tri, count);
}
