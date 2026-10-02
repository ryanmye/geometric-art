// Edge flipping: restores the Delaunay property after points are added or
// removed (Lawson's algorithm).
//
// Two triangles (a, b, c) and (b, a, d) share edge a-b. If d lies strictly
// inside the circle through a, b, c, the edge is "illegal": replacing it by
// the other diagonal c-d gives two fatter triangles. After a flip, the four
// outer edges of the pair are checked again. Each flip strictly improves
// the triangulation, so this always finishes, and when it does every edge
// is legal, which makes it the Delaunay triangulation.

import { inCircle } from './predicates';
import { link, nextEdge, prevEdge, pushEdge, setTriangle, type Triangulation } from './triangulation';

/** Far more flips than any real move needs; reaching it means something is wrong. */
const MAX_FLIPS = 100000;

/**
 * Check the half-edges tri.edgeStack[0 .. count-1] and flip until all are
 * legal. Returns false only if the flip limit was hit (the caller then
 * undoes the move).
 */
export function legalize(tri: Triangulation, count: number): boolean {
  const { xs, ys } = tri;
  let flips = 0;
  while (count > 0) {
    const h = tri.edgeStack[--count];
    const ht = tri.twin[h];
    if (ht < 0) continue; // border edge: never flipped

    const a = tri.corners[h];
    const b = tri.corners[nextEdge(h)];
    const c = tri.corners[prevEdge(h)];
    const d = tri.corners[prevEdge(ht)];
    if (inCircle(xs[a], ys[a], xs[b], ys[b], xs[c], ys[c], xs[d], ys[d]) <= 0) continue;

    if (++flips > MAX_FLIPS) return false;

    // The four outer neighbours, read before anything is overwritten.
    const outBC = tri.twin[nextEdge(h)];
    const outCA = tri.twin[prevEdge(h)];
    const outAD = tri.twin[nextEdge(ht)];
    const outDB = tri.twin[prevEdge(ht)];
    const t1 = (h / 3) | 0;
    const t2 = (ht / 3) | 0;

    // New triangles (c, a, d) and (d, b, c), sharing the new edge c-d.
    setTriangle(tri, t1, c, a, d);
    setTriangle(tri, t2, d, b, c);
    link(tri, 3 * t1, outCA);
    link(tri, 3 * t1 + 1, outAD);
    link(tri, 3 * t1 + 2, 3 * t2 + 2);
    link(tri, 3 * t2, outDB);
    link(tri, 3 * t2 + 1, outBC);

    count = pushEdge(tri, count, 3 * t1);
    count = pushEdge(tri, count, 3 * t1 + 1);
    count = pushEdge(tri, count, 3 * t2);
    count = pushEdge(tri, count, 3 * t2 + 1);
  }
  return true;
}
