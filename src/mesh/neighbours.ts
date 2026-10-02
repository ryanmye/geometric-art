// The points joined to a point by a triangulation edge, and the triangles
// around it, found by turning round the point through the half-edges.

import { nextEdge, prevEdge, type Triangulation } from './triangulation';

/**
 * The half-edge leaving p that comes first going round p, so that a full
 * turn from it meets every triangle: for a point on the image border, the
 * one along the border; otherwise just the stored one. -1 if p is not in
 * the mesh.
 */
export function firstEdgeAround(tri: Triangulation, p: number): number {
  const start = tri.pointEdge[p];
  if (start < 0) return -1;
  let h = start;
  for (let guard = 0; guard <= tri.capacity; guard++) {
    const back = tri.twin[h];
    if (back < 0) return h;
    h = nextEdge(back);
    if (h === start) return start;
  }
  return start;
}

/**
 * Write the neighbours of p into out.list (growing it if needed) and
 * return how many there are.
 */
export function collectNeighbours(tri: Triangulation, p: number, out: { list: Int32Array }): number {
  const first = firstEdgeAround(tri, p);
  if (first < 0) return 0;
  let count = 0;
  let h = first;
  for (let guard = 0; guard <= tri.capacity; guard++) {
    if (count + 2 > out.list.length) {
      const bigger = new Int32Array(out.list.length * 2);
      bigger.set(out.list);
      out.list = bigger;
    }
    out.list[count++] = tri.corners[nextEdge(h)];
    const forward = tri.twin[prevEdge(h)];
    if (forward < 0) {
      // Border point: the last neighbour along the border.
      out.list[count++] = tri.corners[prevEdge(h)];
      break;
    }
    h = forward;
    if (h === first) break;
  }
  return count;
}

/** Call visit(slot) for every triangle that has p as a corner. */
export function forEachTriangleAround(tri: Triangulation, p: number, visit: (slot: number) => void): void {
  const first = firstEdgeAround(tri, p);
  if (first < 0) return;
  let h = first;
  for (let guard = 0; guard <= tri.capacity; guard++) {
    visit((h / 3) | 0);
    h = tri.twin[prevEdge(h)];
    if (h < 0 || h === first) break;
  }
}
