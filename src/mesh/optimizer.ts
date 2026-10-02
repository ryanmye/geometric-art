// The optimiser: moves one point at a time ("threshold accepting", a
// simple relative of simulated annealing).
//
// Each attempt picks a random point (never a corner) and proposes a new
// place for it:
//   - a border point slides along the border by a random amount;
//   - an interior point usually takes a small random step ("nudge");
//   - with probability config.jumpRate it instead jumps into one of the
//     worst-matching triangles, to add detail where it is most missing.
//     The point that jumps is the least useful of three random ones.
//     (Polygon cells: it jumps next to the site of a badly matching cell.)
// The move is kept if the error does not rise by more than a threshold
// (tryMove.ts). The threshold starts at config.tolerance times the average
// triangle's error and shrinks to 0 by the last generation, so early on the
// mesh can climb out of poor arrangements and at the end it only improves.
//
// Step sizes are drawn from a normal distribution whose width is a random
// one of spacing, spacing/2, spacing/4 or spacing/8, so both big moves and
// fine adjustments keep being tried. Only + - * / and Math.sqrt are used,
// so a seed gives the same mesh in every JavaScript engine.

import { borderPoint, borderPosition, isCornerPosition, perimeter } from './border';
import type { MeshState } from './state';
import { readTotals } from './cells';
import { collectNeighbours } from './neighbours';
import { createRunTotals, type RunTotals } from './pixelSums';
import { addTotals } from './slotTotals';
import { gainOf } from './triangleScore';
import { tryMove } from './tryMove';

/** How many random points compete to be the one that jumps. */
const JUMP_CANDIDATES = 3;

const spot = new Int32Array(2);
const mergedTotals = createRunTotals();
const neighbourScratch = { list: new Int32Array(32) };

/** Run one generation: config.points attempted moves. */
export function runGeneration(state: MeshState): void {
  const threshold = thresholdFor(state);
  const attempts = state.config.points;
  for (let i = 0; i < attempts; i++) attemptMove(state, threshold);
  state.generation++;
}

/** How much a move may raise the squared error and still be kept, this generation. */
function thresholdFor(state: MeshState): number {
  const { tri, config } = state;
  if (config.tolerance <= 0 || config.generations <= 0) return 0;
  let total = 0;
  let count = 0;
  if (state.cells) {
    // Polygon cells: the average cell's error instead.
    for (let p = 0; p < config.points; p++) total += state.cells.error[p];
    count = config.points;
  } else for (let t = 0; t < tri.capacity; t++) {
    if (!tri.alive[t]) continue;
    total += state.error[t];
    count++;
  }
  // Share of the run still to go, squared: falls quickly at first, then slowly to 0.
  const left = 1 - state.generation / config.generations;
  return config.tolerance * (total / count) * left * left;
}

function attemptMove(state: MeshState, threshold: number): void {
  const { rng, xs, ys, width, height } = state;
  state.attempts++;
  let p = rng.int(4, state.config.points - 1);
  const sigma = stepWidth(state);
  let x: number;
  let y: number;
  let hint = -1;

  if (p < state.interiorStart) {
    // Slide along the border.
    const loop = perimeter(width, height);
    const s = borderPosition(xs[p], ys[p], width, height);
    let step = Math.round(rng.normal() * sigma);
    if (step === 0) step = rng.next() < 0.5 ? -1 : 1;
    const target = (((s + step) % loop) + loop) % loop;
    if (isCornerPosition(target, width, height)) return;
    borderPoint(target, width, height, spot);
    x = spot[0];
    y = spot[1];
  } else if (rng.next() < state.config.jumpRate) {
    p = leastUsefulOf(state, p);
    if (state.cells) {
      // Polygon cells: jump next to the site of a badly matching cell.
      const site = worstCellOfSome(state);
      hint = (state.tri.pointEdge[site] / 3) | 0;
      x = clamp(Math.round(xs[site] + rng.normal() * state.spacing * 0.5), 1, width - 1);
      y = clamp(Math.round(ys[site] + rng.normal() * state.spacing * 0.5), 1, height - 1);
    } else {
      // Jump into a badly matching triangle.
      const t = worstOfSome(state);
      if (t < 0) return;
      hint = t;
      pointInTriangle(state, t);
      x = clamp(spot[0], 1, width - 1);
      y = clamp(spot[1], 1, height - 1);
    }
  } else {
    // Nudge.
    x = xs[p] + Math.round(rng.normal() * sigma);
    y = ys[p] + Math.round(rng.normal() * sigma);
    if (x === xs[p] && y === ys[p]) {
      if (rng.next() < 0.5) x += rng.next() < 0.5 ? -1 : 1;
      else y += rng.next() < 0.5 ? -1 : 1;
    }
    x = clamp(x, 1, width - 1);
    y = clamp(y, 1, height - 1);
  }

  if (state.occupied[y * (width + 1) + x]) return;
  if (tryMove(state, p, x, y, hint, threshold)) state.accepted++;
}

function stepWidth(state: MeshState): number {
  const k = state.rng.int(0, 3);
  return k === 0 ? state.spacing : k === 1 ? state.spacing / 2 : k === 2 ? state.spacing / 4 : state.spacing / 8;
}

/** Of a few random triangles, the one with the largest error. -1 if none was found. */
function worstOfSome(state: MeshState): number {
  const { tri, rng } = state;
  let best = -1;
  for (let i = 0; i < 4; i++) {
    const t = rng.int(0, tri.capacity - 1);
    if (!tri.alive[t]) continue;
    if (best < 0 || state.error[t] > state.error[best]) best = t;
  }
  return best;
}

/** Polygon cells: of a few random points, the one whose cell has the largest error. */
function worstCellOfSome(state: MeshState): number {
  const cells = state.cells!;
  let best = state.rng.int(4, state.config.points - 1);
  for (let i = 1; i < 4; i++) {
    const p = state.rng.int(4, state.config.points - 1);
    if (cells.error[p] > cells.error[best]) best = p;
  }
  return best;
}

/** Of interior point p and a few other random interior points, the one whose removal costs least. */
function leastUsefulOf(state: MeshState, p: number): number {
  let best = p;
  let bestCost = removalCost(state, p);
  for (let i = 1; i < JUMP_CANDIDATES; i++) {
    const q = state.rng.int(state.interiorStart, state.config.points - 1);
    const cost = removalCost(state, q);
    if (cost < bestCost) {
      best = q;
      bestCost = cost;
    }
  }
  return best;
}

/**
 * Roughly what removing interior point p would cost: the gain lost if the
 * triangles round it were merged into one patch of their common mean colour.
 */
function removalCost(state: MeshState, p: number): number {
  const { tri } = state;
  const start = tri.pointEdge[p];
  if (start < 0) return 0;
  const merged = mergedTotals;
  merged.count = merged.red = merged.green = merged.blue = 0;
  merged.weight = merged.wRed = merged.wGreen = merged.wBlue = 0;
  if (state.cells) return cellRemovalCost(state, p, merged);
  let gain = 0;
  let h = start;
  for (let guard = 0; guard < tri.capacity; guard++) {
    const t = (h / 3) | 0;
    addTotals(state.totals, t, merged);
    gain += state.gain[t];
    // Next triangle round p: across the edge that comes back into p.
    h = tri.twin[h % 3 === 0 ? h + 2 : h - 1];
    if (h < 0 || h === start) break;
  }
  return gain - gainOf(merged, state.weights !== null);
}

/** Polygon cells: the gain lost if p's cell and its neighbours' cells were merged into one patch. */
function cellRemovalCost(state: MeshState, p: number, merged: RunTotals): number {
  const cells = state.cells!;
  const count = collectNeighbours(state.tri, p, neighbourScratch);
  let gain = 0;
  for (let i = -1; i < count; i++) {
    const q = i < 0 ? p : neighbourScratch.list[i];
    const totals = readTotals(cells, q);
    merged.count += totals.count;
    merged.red += totals.red;
    merged.green += totals.green;
    merged.blue += totals.blue;
    merged.weight += totals.weight;
    merged.wRed += totals.wRed;
    merged.wGreen += totals.wGreen;
    merged.wBlue += totals.wBlue;
    gain += cells.gain[q];
  }
  return gain - gainOf(merged, state.weights !== null);
}

/** A random point inside triangle t, rounded to whole pixels, into `spot`. */
function pointInTriangle(state: MeshState, t: number): void {
  const { tri, xs, ys, rng } = state;
  const a = tri.corners[3 * t], b = tri.corners[3 * t + 1], c = tri.corners[3 * t + 2];
  let u = rng.next();
  let v = rng.next();
  if (u + v > 1) {
    u = 1 - u;
    v = 1 - v;
  }
  spot[0] = Math.round(xs[a] + u * (xs[b] - xs[a]) + v * (xs[c] - xs[a]));
  spot[1] = Math.round(ys[a] + u * (ys[b] - ys[a]) + v * (ys[c] - ys[a]));
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}
