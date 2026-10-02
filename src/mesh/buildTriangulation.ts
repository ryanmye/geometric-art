// Build the Delaunay triangulation of a whole point set from scratch.
//
// Points 0-3 must be the image corners (0,0), (width,0), (width,height),
// (0,height). They make two triangles covering the image; every other point
// is then inserted one at a time. A point that cannot be inserted (outside
// the image, or on top of an earlier point) is left out of the mesh: its
// pointEdge stays -1 and no triangle uses it.

import { insertPoint } from './insertPoint';
import { allocSlot, createTriangulation, link, setTriangle, type Triangulation } from './triangulation';
import { undoJournal, beginJournal, commitJournal } from './journal';

export function buildTriangulation(xs: Int32Array, ys: Int32Array): Triangulation {
  const tri = createTriangulation(xs, ys);
  const width = xs[2];
  const height = ys[2];
  if (
    xs[0] !== 0 || ys[0] !== 0 ||
    xs[1] !== width || ys[1] !== 0 ||
    ys[3] !== height || xs[3] !== 0 ||
    width <= 0 || height <= 0
  ) {
    throw new Error('Points 0-3 must be the image corners');
  }

  // Two triangles split along the diagonal from corner 0 to corner 2.
  const first = allocSlot(tri);
  const second = allocSlot(tri);
  setTriangle(tri, first, 0, 1, 2);
  setTriangle(tri, second, 0, 2, 3);
  link(tri, 3 * first, -1);
  link(tri, 3 * first + 1, -1);
  link(tri, 3 * first + 2, 3 * second); // 2->0 and 0->2
  link(tri, 3 * second + 1, -1);
  link(tri, 3 * second + 2, -1);

  let hint = second;
  for (let p = 4; p < xs.length; p++) {
    // Record the insertion so a failed one can be cleanly taken back.
    beginJournal(tri.journal);
    if (insertPoint(tri, p, hint)) {
      commitJournal(tri.journal);
      hint = (tri.pointEdge[p] / 3) | 0;
    } else {
      undoJournal(tri.journal, tri);
    }
  }
  tri.journal.recording = false;
  return tri;
}
