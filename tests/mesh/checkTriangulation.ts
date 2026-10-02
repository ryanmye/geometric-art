// Independent checks that a triangulation is a valid Delaunay mesh of the
// whole image. Returns a list of problems (empty when all is well).

import { inCircle, orient } from '../../src/mesh/predicates';
import { triangleSpans } from '../../src/mesh/rasterize';
import { nextEdge, type Triangulation } from '../../src/mesh/triangulation';

export function checkTriangulation(tri: Triangulation, width: number, height: number): string[] {
  const problems: string[] = [];
  const { xs, ys, corners, twin } = tri;
  let doubleArea = 0;
  let aliveCount = 0;
  const used = new Uint8Array(xs.length);

  for (let t = 0; t < tri.capacity; t++) {
    if (!tri.alive[t]) continue;
    aliveCount++;
    const a = corners[3 * t], b = corners[3 * t + 1], c = corners[3 * t + 2];
    used[a] = used[b] = used[c] = 1;
    const area = orient(xs[a], ys[a], xs[b], ys[b], xs[c], ys[c]);
    if (area <= 0) problems.push(`triangle ${t} (${a},${b},${c}) has area ${area}`);
    doubleArea += area;
    for (let e = 0; e < 3; e++) {
      const h = 3 * t + e;
      const from = corners[h];
      const to = corners[nextEdge(h)];
      const g = twin[h];
      if (g < 0) {
        const onBorder =
          (xs[from] === 0 && xs[to] === 0) ||
          (xs[from] === width && xs[to] === width) ||
          (ys[from] === 0 && ys[to] === 0) ||
          (ys[from] === height && ys[to] === height);
        if (!onBorder) problems.push(`edge ${from}-${to} has no twin but is not on the border`);
        continue;
      }
      if (!tri.alive[(g / 3) | 0]) problems.push(`edge ${h} twins a free slot`);
      if (twin[g] !== h) problems.push(`twin of twin of ${h} is ${twin[g]}`);
      if (corners[g] !== to || corners[nextEdge(g)] !== from) problems.push(`twin ${g} of ${h} is not the reverse edge`);
      // Delaunay: the far vertex of the neighbour is not strictly inside the circumcircle.
      const d = corners[nextEdge(nextEdge(g))];
      if (inCircle(xs[a], ys[a], xs[b], ys[b], xs[c], ys[c], xs[d], ys[d]) > 0) {
        problems.push(`edge ${from}-${to} is not Delaunay`);
      }
    }
  }
  if (doubleArea !== 2 * width * height) problems.push(`triangles cover area ${doubleArea / 2}, image is ${width * height}`);
  if (aliveCount + tri.freeCount !== tri.capacity) problems.push(`slots: ${aliveCount} alive + ${tri.freeCount} free != ${tri.capacity}`);
  for (let i = 0; i < tri.freeCount; i++) {
    if (tri.alive[tri.freeSlots[i]]) problems.push(`free slot ${tri.freeSlots[i]} is alive`);
  }

  for (let p = 0; p < xs.length; p++) {
    const h = tri.pointEdge[p];
    if (h < 0) {
      if (used[p]) problems.push(`point ${p} is used by a triangle but marked as not in the mesh`);
      continue;
    }
    if (!tri.alive[(h / 3) | 0] || corners[h] !== p) problems.push(`pointEdge of ${p} is stale`);
    if (!used[p]) problems.push(`point ${p} is in the mesh but no triangle uses it`);
  }

  // Every pixel centre in exactly one triangle.
  const cover = coverage(tri, width, height);
  let bad = 0;
  for (let i = 0; i < cover.length; i++) if (cover[i] !== 1) bad++;
  if (bad > 0) problems.push(`${bad} pixels are not covered exactly once`);
  return problems.slice(0, 20);
}

/** How many triangles claim each pixel. */
export function coverage(tri: Triangulation, width: number, height: number): Uint8Array {
  const cover = new Uint8Array(width * height);
  const runs = new Int32Array(3 * height);
  const { xs, ys, corners } = tri;
  for (let t = 0; t < tri.capacity; t++) {
    if (!tri.alive[t]) continue;
    const a = corners[3 * t], b = corners[3 * t + 1], c = corners[3 * t + 2];
    const n = triangleSpans(xs[a], ys[a], xs[b], ys[b], xs[c], ys[c], width, height, runs);
    for (let i = 0; i < n; i++) {
      const row = runs[3 * i];
      for (let x = runs[3 * i + 1]; x <= runs[3 * i + 2]; x++) cover[row * width + x]++;
    }
  }
  return cover;
}

/**
 * Brute force, independent of triangleSpans: for each pixel centre, the
 * triangles containing it (closed). Returns, per pixel, how many contain it
 * strictly inside, and whether the rasterizer's choice contains it at all.
 */
export function bruteForceOwnerCheck(tri: Triangulation, width: number, height: number): string[] {
  const problems: string[] = [];
  const { xs, ys, corners } = tri;
  const owner = new Int32Array(width * height).fill(-1);
  const runs = new Int32Array(3 * height);
  for (let t = 0; t < tri.capacity; t++) {
    if (!tri.alive[t]) continue;
    const a = corners[3 * t], b = corners[3 * t + 1], c = corners[3 * t + 2];
    const n = triangleSpans(xs[a], ys[a], xs[b], ys[b], xs[c], ys[c], width, height, runs);
    for (let i = 0; i < n; i++) {
      for (let x = runs[3 * i + 1]; x <= runs[3 * i + 2]; x++) owner[runs[3 * i] * width + x] = t;
    }
  }
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const cx = px + 0.5, cy = py + 0.5;
      const t = owner[py * width + px];
      if (t < 0) continue; // reported by coverage()
      for (let s = 0; s < tri.capacity; s++) {
        if (!tri.alive[s]) continue;
        const a = corners[3 * s], b = corners[3 * s + 1], c = corners[3 * s + 2];
        const o0 = orient(xs[a], ys[a], xs[b], ys[b], cx, cy);
        const o1 = orient(xs[b], ys[b], xs[c], ys[c], cx, cy);
        const o2 = orient(xs[c], ys[c], xs[a], ys[a], cx, cy);
        const strictly = o0 > 0 && o1 > 0 && o2 > 0;
        const closed = o0 >= 0 && o1 >= 0 && o2 >= 0;
        if (strictly && s !== t) problems.push(`pixel ${px},${py} is strictly inside ${s} but given to ${t}`);
        if (s === t && !closed) problems.push(`pixel ${px},${py} given to ${t}, which does not contain it`);
      }
    }
  }
  return problems.slice(0, 20);
}
