// The triangulation data structure, and the low-level writes that change it.
//
// Triangles live in numbered "slots". Slot t holds one triangle as three
// vertex numbers (point indices) in corners[3t], corners[3t+1], corners[3t+2],
// always in clockwise order on screen (orient > 0, see predicates.ts).
//
// Each triangle has three "half-edges", numbered 3t, 3t+1, 3t+2. Half-edge
// h runs from corners[h] to the next corner of the same triangle. The
// triangle on the other side of that edge holds the same edge in the
// opposite direction; twin[h] is that half-edge, or -1 when the edge is on
// the image border. (This is the layout the delaunator library uses too.)
//
// Every write goes through the functions at the bottom of this file. While
// a move is being tried they record the old values in a journal, so a
// rejected move can be undone exactly (see journal.ts), and they note which
// slots changed, so only those triangles are re-scored.

import { createJournal, record, type Journal } from './journal';

export interface Triangulation {
  /** Point coordinates (integers). Owned by the optimiser; read here. */
  xs: Int32Array;
  ys: Int32Array;
  /** Number of slots. */
  capacity: number;
  /** 3 per slot: vertex numbers. */
  corners: Int32Array;
  /** 3 per slot: the opposite half-edge, or -1 on the border. */
  twin: Int32Array;
  /** 1 per slot: 1 if the slot holds a triangle, 0 if it is free. */
  alive: Uint8Array;
  /** Per point: a half-edge that starts at the point, or -1 if the point is not in the mesh. */
  pointEdge: Int32Array;
  /** Stack of free slots; freeSlots[0 .. freeCount-1] are free. */
  freeSlots: Int32Array;
  freeCount: number;

  journal: Journal;

  /** Slots changed since the last clearTouched(), each listed once. */
  touched: Int32Array;
  touchedCount: number;
  /** Per slot: whether it held a triangle before it was first touched. */
  wasAlive: Uint8Array;
  /** Per slot: the value of `stamp` when it was last added to `touched`. */
  touchStamp: Int32Array;
  stamp: number;

  /** Scratch stack of half-edges to check during legalize(). */
  edgeStack: Int32Array;
}

// Journal codes: which array a recorded write belongs to.
export const J_CORNERS = 0;
export const J_TWIN = 1;
export const J_ALIVE = 2;
export const J_POINT_EDGE = 3;
export const J_FREE_SLOTS = 4;
export const J_FREE_COUNT = 5;

/** The next half-edge in the same triangle. */
export function nextEdge(h: number): number {
  return h % 3 === 2 ? h - 2 : h + 1;
}

/** The previous half-edge in the same triangle. */
export function prevEdge(h: number): number {
  return h % 3 === 0 ? h + 2 : h - 1;
}

/** An empty triangulation with room for the mesh of `pointCount` points. */
export function createTriangulation(xs: Int32Array, ys: Int32Array): Triangulation {
  const pointCount = xs.length;
  // A triangulation of n points has at most 2n - 5 triangles; a few spare
  // slots cover the moment during a move when old and new ones overlap.
  const capacity = 2 * pointCount + 16;
  const freeSlots = new Int32Array(capacity);
  // Hand out low slot numbers first.
  for (let i = 0; i < capacity; i++) freeSlots[i] = capacity - 1 - i;
  return {
    xs,
    ys,
    capacity,
    corners: new Int32Array(3 * capacity).fill(-1),
    twin: new Int32Array(3 * capacity).fill(-1),
    alive: new Uint8Array(capacity),
    pointEdge: new Int32Array(pointCount).fill(-1),
    freeSlots,
    freeCount: capacity,
    journal: createJournal(),
    touched: new Int32Array(capacity),
    touchedCount: 0,
    wasAlive: new Uint8Array(capacity),
    touchStamp: new Int32Array(capacity),
    stamp: 1,
    edgeStack: new Int32Array(64),
  };
}

/** Forget the list of touched slots (start of a new move). */
export function clearTouched(tri: Triangulation): void {
  tri.touchedCount = 0;
  tri.stamp++;
}

/** Note that slot t is about to change, remembering whether it held a triangle before. */
function touch(tri: Triangulation, t: number): void {
  if (tri.touchStamp[t] === tri.stamp) return;
  tri.touchStamp[t] = tri.stamp;
  tri.wasAlive[t] = tri.alive[t];
  tri.touched[tri.touchedCount++] = t;
}

/** Take a free slot. Returns -1 if none is left (cannot happen for a valid mesh). */
export function allocSlot(tri: Triangulation): number {
  if (tri.freeCount === 0) return -1;
  record(tri.journal, J_FREE_COUNT, 0, tri.freeCount);
  tri.freeCount--;
  const t = tri.freeSlots[tri.freeCount];
  touch(tri, t);
  record(tri.journal, J_ALIVE, t, tri.alive[t]);
  tri.alive[t] = 1;
  return t;
}

/** Give slot t back. */
export function freeSlot(tri: Triangulation, t: number): void {
  touch(tri, t);
  record(tri.journal, J_ALIVE, t, tri.alive[t]);
  tri.alive[t] = 0;
  record(tri.journal, J_FREE_SLOTS, tri.freeCount, tri.freeSlots[tri.freeCount]);
  tri.freeSlots[tri.freeCount] = t;
  record(tri.journal, J_FREE_COUNT, 0, tri.freeCount);
  tri.freeCount++;
}

/** Store triangle (a, b, c) in slot t. The twins must be set separately with link(). */
export function setTriangle(tri: Triangulation, t: number, a: number, b: number, c: number): void {
  touch(tri, t);
  const h = 3 * t;
  writeCorner(tri, h, a);
  writeCorner(tri, h + 1, b);
  writeCorner(tri, h + 2, c);
  writePointEdge(tri, a, h);
  writePointEdge(tri, b, h + 1);
  writePointEdge(tri, c, h + 2);
}

/** Make half-edges h1 and h2 twins. h2 may be -1 (h1 is then on the border). */
export function link(tri: Triangulation, h1: number, h2: number): void {
  writeTwin(tri, h1, h2);
  if (h2 >= 0) writeTwin(tri, h2, h1);
}

/** Mark a point as no longer in the mesh. */
export function detachPoint(tri: Triangulation, p: number): void {
  writePointEdge(tri, p, -1);
}

function writeCorner(tri: Triangulation, h: number, value: number): void {
  record(tri.journal, J_CORNERS, h, tri.corners[h]);
  tri.corners[h] = value;
}

function writeTwin(tri: Triangulation, h: number, value: number): void {
  record(tri.journal, J_TWIN, h, tri.twin[h]);
  tri.twin[h] = value;
}

function writePointEdge(tri: Triangulation, p: number, value: number): void {
  record(tri.journal, J_POINT_EDGE, p, tri.pointEdge[p]);
  tri.pointEdge[p] = value;
}

/** Push a half-edge onto the legalize stack, growing it if needed. */
export function pushEdge(tri: Triangulation, count: number, h: number): number {
  if (count === tri.edgeStack.length) {
    const bigger = new Int32Array(tri.edgeStack.length * 2);
    bigger.set(tri.edgeStack);
    tri.edgeStack = bigger;
  }
  tri.edgeStack[count] = h;
  return count + 1;
}
