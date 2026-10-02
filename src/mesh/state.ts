// Everything the optimiser keeps between moves, and how it is set up.

import type { Bitmap, ImportanceInfo } from '../engine/types';
import { createRng, type Rng } from '../engine/rng';
import { buildTriangulation } from './buildTriangulation';
import { createCells, type CellData } from './cells';
import { initialPoints, type PointLayout } from './initialPoints';
import { createPixelSums, type PixelSums } from './pixelSums';
import { SLOT_FIELDS, storeTotals } from './slotTotals';
import { createTriangleScorer, errorOf, gainOf, measureTriangle, type TriangleScorer } from './triangleScore';
import type { Triangulation } from './triangulation';
import type { MeshConfig } from './types';
import type { MeshWeighting } from './weights';

export interface MeshState {
  width: number;
  height: number;
  config: MeshConfig;
  /** Whole-number per-pixel weights (weights.ts), or null for an unweighted run. */
  weights: Uint16Array | null;
  /** How the weights were made (copied into results), or null. */
  importance: ImportanceInfo | null;
  sums: PixelSums;
  scorer: TriangleScorer;
  /** Point coordinates. 0-3 are the corners, then border points, then interior points. */
  xs: Int32Array;
  ys: Int32Array;
  borderStart: number;
  interiorStart: number;
  tri: Triangulation;
  /** Per triangle slot: its gain and its (weighted) squared error (see triangleScore.ts). */
  gain: Float64Array;
  error: Float64Array;
  /** Per triangle slot: pixel totals, SLOT_FIELDS numbers each (slotTotals.ts). */
  totals: Float64Array;
  /** Per grid position (y * (width + 1) + x): 1 if a point is there. */
  occupied: Uint8Array;
  rng: Rng;
  /** Generations completed. */
  generation: number;
  /** Average distance between neighbouring points: the scale of a typical move. */
  spacing: number;
  /** Scratch for the triangles a move creates, by position in the touched list. */
  newGain: Float64Array;
  newError: Float64Array;
  newTotals: Float64Array;
  /** Polygon cells (config.cells = 'polygons'), or null for triangles. */
  cells: CellData | null;
  /** Counters, for tuning and tests. */
  attempts: number;
  accepted: number;
  /** Moves the triangulation refused (should stay 0 apart from rare edge cases). */
  refused: number;
}

/**
 * Set up a run. `layout` replaces the usual starting points (the seed
 * animation starts later frames from frame 0's points); it must have the
 * corners, border and interior points in the usual order and places.
 */
export function createMeshState(
  target: Bitmap,
  config: MeshConfig,
  weighting: MeshWeighting | null = null,
  layout?: PointLayout,
): MeshState {
  const { width, height } = target;
  const weights = weighting ? weighting.weights : null;
  // Separate generators for the start layout and for the moves.
  const start = layout ?? initialPoints(target, config.points, config.borderDensity, createRng(config.seed, 0), weights);
  const tri = buildTriangulation(start.xs, start.ys);
  const sums = createPixelSums(target, weights);
  const scorer = createTriangleScorer(sums);
  const weighted = weights !== null;

  const gain = new Float64Array(tri.capacity);
  const error = new Float64Array(tri.capacity);
  const totals = new Float64Array(SLOT_FIELDS * tri.capacity);
  const { xs, ys, corners } = tri;
  for (let t = 0; t < tri.capacity; t++) {
    if (!tri.alive[t]) continue;
    const a = corners[3 * t], b = corners[3 * t + 1], c = corners[3 * t + 2];
    const measured = measureTriangle(scorer, xs[a], ys[a], xs[b], ys[b], xs[c], ys[c]);
    gain[t] = gainOf(measured, weighted);
    error[t] = errorOf(measured, weighted, gain[t]);
    storeTotals(totals, t, measured);
  }

  const occupied = new Uint8Array((width + 1) * (height + 1));
  for (let p = 0; p < config.points; p++) occupied[ys[p] * (width + 1) + xs[p]] = 1;

  return {
    width,
    height,
    config,
    weights,
    importance: weighting ? weighting.importance : null,
    sums,
    scorer,
    xs,
    ys,
    borderStart: start.borderStart,
    interiorStart: start.interiorStart,
    tri,
    gain,
    error,
    totals,
    occupied,
    rng: createRng(config.seed, 1),
    generation: 0,
    spacing: Math.sqrt((width * height) / config.points),
    newGain: new Float64Array(tri.capacity),
    newError: new Float64Array(tri.capacity),
    newTotals: new Float64Array(SLOT_FIELDS * tri.capacity),
    cells: config.cells === 'polygons' ? createCells(target, weights, tri) : null,
    attempts: 0,
    accepted: 0,
    refused: 0,
  };
}

/** Sum of the (weighted) squared errors of all triangles or cells, as the optimiser tracks it (mean colours, not rounded). */
export function trackedError(state: MeshState): number {
  let total = 0;
  if (state.cells) {
    for (let p = 0; p < state.config.points; p++) total += state.cells.error[p];
    return total;
  }
  for (let t = 0; t < state.tri.capacity; t++) if (state.tri.alive[t]) total += state.error[t];
  return total;
}
