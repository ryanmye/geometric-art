// Polygon cells (config.cells = 'polygons'): each point owns the pixels
// nearer to it than to any other point, i.e. its Voronoi cell, filled with
// the mean colour of those pixels.
//
// Ownership rule, exact: pixel (px, py) belongs to the point with the
// smallest squared distance from the pixel centre (px + 0.5, py + 0.5); on
// a tie, to the point with the smaller index. Distances are computed with
// doubled coordinates, (2px + 1 - 2x)^2 + (2py + 1 - 2y)^2, which are whole
// numbers, so the rule is exact and the same on every machine. Every pixel
// belongs to exactly one point. owner[] stores the result for every pixel.
//
// Finding the nearest point quickly: in a Delaunay triangulation, if a
// point q is not the nearest to a pixel, one of q's neighbours is strictly
// nearer (shrink the circle round the pixel through q until it is empty; the
// points on it next to q are joined to q by Delaunay edges and are nearer).
// So walking from any point to a nearer neighbour until none is nearer
// reaches the smallest distance. Points tied at that distance lie on an
// empty circle and are joined in a ring by Delaunay edges, so collecting the
// tied neighbours finds them all, and the smallest index wins.
//
// Moving point p only changes pixels in p's old cell (they go to the
// nearest remaining point, maybe p at its new place) and pixels p wins at
// its new place (inside its new cell). A cell lies within the bounding box
// of p and the circumcentres of the triangles round p, clipped to the image
// (the cell is the polygon with those circumcentres as corners, or, on the
// border, that polygon with rays leading straight out of the image).
// Per-point totals are whole-number sums, so updating them pixel by pixel
// gives exactly the from-scratch totals.

import type { Bitmap } from '../engine/types';
import { createRunTotals, type RunTotals } from './pixelSums';
import { errorOf, gainOf } from './triangleScore';
import { nextEdge, prevEdge, type Triangulation } from './triangulation';

/** Numbers kept per cell: count, red, green, blue, squares, then the weighted five. */
export const CELL_FIELDS = 10;

export interface CellData {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  weights: Uint16Array | null;
  /** Per pixel: index of the point that owns it. */
  owner: Int32Array;
  /** Per point: pixel totals (CELL_FIELDS each), gain and (weighted) squared error. */
  totals: Float64Array;
  gain: Float64Array;
  error: Float64Array;

  // Scratch for one move, so it can be scored and undone.
  /** Pixels whose owner changed: pixel index, then its previous owner. */
  log: Int32Array;
  logLength: number;
  /** Points whose totals changed, each once; their totals before the move. */
  touched: Int32Array;
  touchedCount: number;
  touchStamp: Int32Array;
  stamp: number;
  savedTotals: Float64Array;
  newGain: Float64Array;
  newError: Float64Array;
  /** Neighbour lists and the tie search. */
  neighbours: { list: Int32Array };
  /** Whose neighbours are in `neighbours.list` (-1: none; reset whenever the triangulation may have changed). */
  listOf: number;
  listCount: number;
  tieStack: Int32Array;
  tieStamp: Int32Array;
  tieMark: number;
  oldBox: Int32Array;
  newBox: Int32Array;
  runTotals: RunTotals;
}

/** Set up cells for the current triangulation: every pixel's owner and every cell's totals. */
export function createCells(target: Bitmap, weights: Uint16Array | null, tri: Triangulation): CellData {
  const { width, height, data } = target;
  const points = tri.xs.length;
  const cells: CellData = {
    width,
    height,
    data,
    weights,
    owner: new Int32Array(width * height),
    totals: new Float64Array(CELL_FIELDS * points),
    gain: new Float64Array(points),
    error: new Float64Array(points),
    log: new Int32Array(1024),
    logLength: 0,
    touched: new Int32Array(points),
    touchedCount: 0,
    touchStamp: new Int32Array(points),
    stamp: 1,
    savedTotals: new Float64Array(CELL_FIELDS * points),
    newGain: new Float64Array(points),
    newError: new Float64Array(points),
    neighbours: { list: new Int32Array(32) },
    listOf: -1,
    listCount: 0,
    tieStack: new Int32Array(points),
    tieStamp: new Int32Array(points),
    tieMark: 0,
    oldBox: new Int32Array(4),
    newBox: new Int32Array(4),
    runTotals: createRunTotals(),
  };
  // Assign every pixel, starting each search from the previous pixel's owner.
  let hint = 0;
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      hint = nearestPoint(cells, tri, px, py, hint);
      cells.owner[py * width + px] = hint;
      addPixel(cells, py * width + px, hint, 1);
    }
  }
  for (let p = 0; p < points; p++) scoreCell(cells, p);
  return cells;
}

/** Squared distance from the centre of pixel (px, py) to point p, in doubled coordinates. */
function distance(tri: Triangulation, px: number, py: number, p: number): number {
  const dx = 2 * px + 1 - 2 * tri.xs[p];
  const dy = 2 * py + 1 - 2 * tri.ys[p];
  return dx * dx + dy * dy;
}

/** The owner of pixel (px, py) by the rule above, searching from point `start` (which must be in the mesh). */
export function nearestPoint(cells: CellData, tri: Triangulation, px: number, py: number, start: number): number {
  let best = start;
  let bestDistance = distance(tri, px, py, best);
  let tied = false;
  // Walk to nearer neighbours until there is none, noting ties on the way.
  for (let guard = 0; guard <= tri.xs.length; guard++) {
    // Neighbouring pixels usually search from the same point: reuse its list.
    if (cells.listOf !== best) {
      cells.listCount = neighboursAnyOrder(cells, tri, best);
      cells.listOf = best;
    }
    const count = cells.listCount;
    const list = cells.neighbours.list;
    const from = best;
    tied = false;
    for (let i = 0; i < count; i++) {
      const d = distance(tri, px, py, list[i]);
      if (d < bestDistance) {
        best = list[i];
        bestDistance = d;
        tied = false;
      } else if (d === bestDistance) {
        tied = true;
      }
    }
    if (best === from) break;
    // Moved: ties seen so far may be with the old point; check again from the new one.
  }
  if (!tied) return best;

  // Points tied at the same distance: collect them all, keep the smallest index.
  const mark = ++cells.tieMark;
  cells.listOf = -1; // the search below overwrites the list
  let winner = best;
  let stackSize = 0;
  cells.tieStack[stackSize++] = best;
  cells.tieStamp[best] = mark;
  while (stackSize > 0) {
    const q = cells.tieStack[--stackSize];
    if (q < winner) winner = q;
    const n = neighboursAnyOrder(cells, tri, q);
    for (let i = 0; i < n; i++) {
      const s = cells.neighbours.list[i];
      if (cells.tieStamp[s] !== mark && distance(tri, px, py, s) === bestDistance) {
        cells.tieStamp[s] = mark;
        cells.tieStack[stackSize++] = s;
      }
    }
  }
  return winner;
}

/**
 * The neighbours of q, in no particular order, into cells.neighbours.list
 * (faster than collectNeighbours: one turn round q, or for a border point
 * part of a turn each way from the stored edge). Returns the count.
 */
function neighboursAnyOrder(cells: CellData, tri: Triangulation, q: number): number {
  const { corners, twin } = tri;
  const start = tri.pointEdge[q];
  let list = cells.neighbours.list;
  let count = 0;
  let h = start;
  for (let guard = 0; guard <= tri.capacity; guard++) {
    if (count + 2 > list.length) list = growNeighbours(cells);
    list[count++] = corners[nextEdge(h)];
    const forward = twin[prevEdge(h)];
    if (forward < 0) {
      // Reached the border: the last neighbour that way, then go the other way.
      list[count++] = corners[prevEdge(h)];
      let back = start;
      for (let more = 0; more <= tri.capacity; more++) {
        const b = twin[back];
        if (b < 0) break;
        back = nextEdge(b);
        if (count + 1 > list.length) list = growNeighbours(cells);
        list[count++] = corners[nextEdge(back)];
      }
      break;
    }
    h = forward;
    if (h === start) break;
  }
  return count;
}

function growNeighbours(cells: CellData): Int32Array {
  const bigger = new Int32Array(cells.neighbours.list.length * 2);
  bigger.set(cells.neighbours.list);
  cells.neighbours.list = bigger;
  return bigger;
}

/** Whether point a is preferred over point b for pixel (px, py). */
function prefers(tri: Triangulation, px: number, py: number, a: number, b: number): boolean {
  const da = distance(tri, px, py, a);
  const db = distance(tri, px, py, b);
  return da < db || (da === db && a < b);
}

/**
 * Pixel rectangle sure to contain p's cell: p and the circumcentres of the
 * triangles round p, widened by a pixel for rounding, clipped to the image.
 * Written as [firstX, lastX, firstY, lastY] into `box`.
 */
export function cellBox(cells: CellData, tri: Triangulation, p: number, box: Int32Array): void {
  const { xs, ys, corners, twin } = tri;
  let minX = xs[p], maxX = xs[p], minY = ys[p], maxY = ys[p];
  // Turn round p (as in neighbours.ts), visiting every triangle.
  let first = tri.pointEdge[p];
  for (let guard = 0; guard <= tri.capacity; guard++) {
    const back = twin[first];
    if (back < 0) break;
    const next = nextEdge(back);
    if (next === tri.pointEdge[p]) break;
    first = next;
  }
  let h = first;
  for (let guard = 0; guard <= tri.capacity; guard++) {
    const t = 3 * ((h / 3) | 0);
    const ax = xs[corners[t]], ay = ys[corners[t]];
    const bx = xs[corners[t + 1]] - ax, by = ys[corners[t + 1]] - ay;
    const cx = xs[corners[t + 2]] - ax, cy = ys[corners[t + 2]] - ay;
    const d = 2 * (bx * cy - by * cx);
    const b2 = bx * bx + by * by;
    const c2 = cx * cx + cy * cy;
    const ux = ax + (cy * b2 - by * c2) / d;
    const uy = ay + (bx * c2 - cx * b2) / d;
    if (ux < minX) minX = ux;
    if (ux > maxX) maxX = ux;
    if (uy < minY) minY = uy;
    if (uy > maxY) maxY = uy;
    h = twin[prevEdge(h)];
    if (h < 0 || h === first) break;
  }
  box[0] = Math.max(0, Math.floor(minX) - 1);
  box[1] = Math.min(cells.width - 1, Math.ceil(maxX) + 1);
  box[2] = Math.max(0, Math.floor(minY) - 1);
  box[3] = Math.min(cells.height - 1, Math.ceil(maxY) + 1);
}

/**
 * After point p has moved in the triangulation (its old cell's box was
 * stored in cells.oldBox before the move), update every pixel's owner and
 * the cell totals, recording everything for undo. Returns the change in
 * total gain.
 */
export function updateCellsAfterMove(cells: CellData, tri: Triangulation, p: number): number {
  const { width, owner } = cells;
  cells.listOf = -1; // the triangulation has changed
  cells.logLength = 0;
  cells.touchedCount = 0;
  cells.stamp++;

  // 1. Pixels of p's old cell go to whoever is nearest now.
  const old = cells.oldBox;
  let hint = p;
  for (let py = old[2]; py <= old[3]; py++) {
    for (let px = old[0]; px <= old[1]; px++) {
      const i = py * width + px;
      if (owner[i] !== p) continue;
      hint = nearestPoint(cells, tri, px, py, hint);
      if (hint !== p) changeOwner(cells, i, p, hint);
    }
  }

  // 2. Pixels p wins at its new place, all inside its new cell's box.
  const box = cells.newBox;
  cellBox(cells, tri, p, box);
  for (let py = box[2]; py <= box[3]; py++) {
    for (let px = box[0]; px <= box[1]; px++) {
      const i = py * width + px;
      const current = owner[i];
      if (current !== p && prefers(tri, px, py, p, current)) changeOwner(cells, i, current, p);
    }
  }

  // 3. Re-score the cells that changed.
  let change = 0;
  for (let k = 0; k < cells.touchedCount; k++) {
    const q = cells.touched[k];
    const totals = readTotals(cells, q);
    const gain = gainOf(totals, cells.weights !== null);
    cells.newGain[k] = gain;
    cells.newError[k] = errorOf(totals, cells.weights !== null, gain);
    change += gain - cells.gain[q];
  }
  return change;
}

/** Keep the move: store the new scores. */
export function commitCells(cells: CellData): void {
  for (let k = 0; k < cells.touchedCount; k++) {
    const q = cells.touched[k];
    cells.gain[q] = cells.newGain[k];
    cells.error[q] = cells.newError[k];
  }
  cells.logLength = 0;
  cells.touchedCount = 0;
}

/** Reject the move: put every owner and total back. */
export function undoCells(cells: CellData): void {
  for (let k = cells.logLength - 2; k >= 0; k -= 2) cells.owner[cells.log[k]] = cells.log[k + 1];
  for (let k = 0; k < cells.touchedCount; k++) {
    const q = cells.touched[k];
    for (let f = 0; f < CELL_FIELDS; f++) cells.totals[CELL_FIELDS * q + f] = cells.savedTotals[CELL_FIELDS * k + f];
  }
  cells.logLength = 0;
  cells.touchedCount = 0;
}

function changeOwner(cells: CellData, pixel: number, from: number, to: number): void {
  if (cells.logLength + 2 > cells.log.length) {
    const bigger = new Int32Array(cells.log.length * 2);
    bigger.set(cells.log);
    cells.log = bigger;
  }
  cells.log[cells.logLength++] = pixel;
  cells.log[cells.logLength++] = from;
  touchCell(cells, from);
  touchCell(cells, to);
  cells.owner[pixel] = to;
  addPixel(cells, pixel, from, -1);
  addPixel(cells, pixel, to, 1);
}

function touchCell(cells: CellData, q: number): void {
  if (cells.touchStamp[q] === cells.stamp) return;
  cells.touchStamp[q] = cells.stamp;
  const k = cells.touchedCount++;
  cells.touched[k] = q;
  for (let f = 0; f < CELL_FIELDS; f++) cells.savedTotals[CELL_FIELDS * k + f] = cells.totals[CELL_FIELDS * q + f];
}

/** Add (sign 1) or remove (sign -1) one pixel's values to/from cell q's totals. */
function addPixel(cells: CellData, pixel: number, q: number, sign: number): void {
  const { data, weights, totals } = cells;
  const r = data[4 * pixel], g = data[4 * pixel + 1], b = data[4 * pixel + 2];
  const s = r * r + g * g + b * b;
  const i = CELL_FIELDS * q;
  totals[i] += sign;
  totals[i + 1] += sign * r;
  totals[i + 2] += sign * g;
  totals[i + 3] += sign * b;
  totals[i + 4] += sign * s;
  if (weights) {
    const w = sign * weights[pixel];
    totals[i + 5] += w;
    totals[i + 6] += w * r;
    totals[i + 7] += w * g;
    totals[i + 8] += w * b;
    totals[i + 9] += w * s;
  }
}

/** Cell q's totals as a RunTotals (a shared scratch object). */
export function readTotals(cells: CellData, q: number): RunTotals {
  const t = cells.runTotals;
  const i = CELL_FIELDS * q;
  const a = cells.totals;
  t.count = a[i];
  t.red = a[i + 1];
  t.green = a[i + 2];
  t.blue = a[i + 3];
  t.squares = a[i + 4];
  t.weight = a[i + 5];
  t.wRed = a[i + 6];
  t.wGreen = a[i + 7];
  t.wBlue = a[i + 8];
  t.wSquares = a[i + 9];
  return t;
}

function scoreCell(cells: CellData, q: number): void {
  const totals = readTotals(cells, q);
  cells.gain[q] = gainOf(totals, cells.weights !== null);
  cells.error[q] = errorOf(totals, cells.weights !== null, cells.gain[q]);
}
