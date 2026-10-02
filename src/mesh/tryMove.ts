// Try moving one point, and keep the move only if the mesh gets better.
//
// The point is taken out of the triangulation and put back at its new
// place. Only the triangles that changed are re-scored: the ones that
// disappeared lose their gain, the new ones add theirs. If the error went
// up by more than the allowed threshold, the journal undoes every change.

import { cellBox, commitCells, undoCells, updateCellsAfterMove } from './cells';
import { beginJournal, commitJournal, undoJournal } from './journal';
import { insertPoint } from './insertPoint';
import { removePoint } from './removePoint';
import type { MeshState } from './state';
import { copyTotals, storeTotals } from './slotTotals';
import { errorOf, gainOf, measureTriangle } from './triangleScore';
import { clearTouched } from './triangulation';

/**
 * Move point p to (x, y), which must be free. `hint` is a triangle slot
 * near (x, y), or -1. The move is kept if it raises the squared error by
 * less than `threshold` (0: only if it lowers it). Returns true if kept.
 */
export function tryMove(state: MeshState, p: number, x: number, y: number, hint: number, threshold: number): boolean {
  const { tri, xs, ys } = state;
  const oldX = xs[p];
  const oldY = ys[p];

  const cells = state.cells;
  if (cells) cellBox(cells, tri, p, cells.oldBox); // before p leaves its old place
  clearTouched(tri);
  beginJournal(tri.journal);
  let ok = removePoint(tri, p);
  xs[p] = x;
  ys[p] = y;
  if (ok) {
    if (hint < 0 || !tri.alive[hint]) hint = someLiveTouched(state);
    ok = insertPoint(tri, p, hint);
  }
  if (!ok) {
    undoJournal(tri.journal, tri);
    xs[p] = oldX;
    ys[p] = oldY;
    state.refused++;
    return false;
  }

  if (cells) {
    // Polygon cells: re-assign the pixels that can change owner (cells.ts).
    const change = updateCellsAfterMove(cells, tri, p);
    if (change > -threshold) {
      commitJournal(tri.journal);
      commitCells(cells);
      const stride = state.width + 1;
      state.occupied[oldY * stride + oldX] = 0;
      state.occupied[y * stride + x] = 1;
      return true;
    }
    undoJournal(tri.journal, tri);
    undoCells(cells);
    xs[p] = oldX;
    ys[p] = oldY;
    return false;
  }

  // Score the change.
  const { corners, touched, touchedCount, wasAlive, alive } = tri;
  const weighted = state.weights !== null;
  let lost = 0;
  let won = 0;
  for (let i = 0; i < touchedCount; i++) {
    const t = touched[i];
    if (wasAlive[t]) lost += state.gain[t];
    if (alive[t]) {
      const a = corners[3 * t], b = corners[3 * t + 1], c = corners[3 * t + 2];
      const totals = measureTriangle(state.scorer, xs[a], ys[a], xs[b], ys[b], xs[c], ys[c]);
      const gain = gainOf(totals, weighted);
      state.newGain[i] = gain;
      state.newError[i] = errorOf(totals, weighted, gain);
      storeTotals(state.newTotals, i, totals);
      won += gain;
    }
  }

  if (won - lost > -threshold) {
    commitJournal(tri.journal);
    for (let i = 0; i < touchedCount; i++) {
      const t = touched[i];
      if (alive[t]) {
        state.gain[t] = state.newGain[i];
        state.error[t] = state.newError[i];
        copyTotals(state.newTotals, i, state.totals, t);
      }
    }
    const stride = state.width + 1;
    state.occupied[oldY * stride + oldX] = 0;
    state.occupied[y * stride + x] = 1;
    return true;
  }

  undoJournal(tri.journal, tri);
  xs[p] = oldX;
  ys[p] = oldY;
  return false;
}

/** A triangle created by the removal: it lies where the point was. */
function someLiveTouched(state: MeshState): number {
  const { tri } = state;
  for (let i = tri.touchedCount - 1; i >= 0; i--) {
    if (tri.alive[tri.touched[i]]) return tri.touched[i];
  }
  return -1;
}
