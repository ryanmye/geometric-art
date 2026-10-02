// The searching side of a run. Each web worker holds one Searcher (its own
// copy of the target and the current picture); the inline executor holds one
// or more on the calling thread. Both call exactly these functions.

import type { Bitmap, RGB, RunConfig, ShapeRecord, Shape } from './types';
import { createPicture, paint, averageColor, type Picture } from './picture';
import { createScanlines, type Scanlines } from './scanlines';
import { createShapeContext, rasterizeShape, type ShapeContext } from './shapes';
import { computeErrorGrid, type ErrorGrid } from './errorGrid';
import { climb } from './search';
import { createRng } from './rng';

export interface Searcher {
  picture: Picture;
  config: RunConfig;
  shapeContext: ShapeContext;
  lines: Scanlines;
  /** Error grid for the current picture; made when first needed, cleared when the picture changes. */
  errorGrid: ErrorGrid | null;
}

/** The best result among some climbs. */
export interface SearchOutcome {
  shape: Shape;
  /** Picture total if this shape were painted. */
  total: number;
  /** Which climb found it (ties go to the lowest index). */
  climb: number;
  /** Shapes scored across all the climbs, for speed statistics. */
  evaluations: number;
}

/**
 * Start from the target's average colour and paint the prefix shapes.
 * `weights` are whole-number per-pixel weights from integerWeights(), or null.
 */
export function createSearcher(
  target: Bitmap,
  config: RunConfig,
  prefix: ShapeRecord[] = [],
  weights: Uint16Array | null = null,
): Searcher {
  const background: RGB = averageColor(target);
  const searcher: Searcher = {
    picture: createPicture(target, background, weights),
    config,
    shapeContext: createShapeContext(target.width, target.height),
    lines: createScanlines(target.height),
    errorGrid: null,
  };
  for (const record of prefix) addRecord(searcher, record);
  return searcher;
}

/** Paint an accepted shape so the next search starts from the new picture. */
export function addRecord(searcher: Searcher, record: ShapeRecord): void {
  paintRecord(searcher.picture, searcher.lines, record);
  searcher.errorGrid = null;
}

/** Paint a record's shape in its stored colour and opacity. */
export function paintRecord(picture: Picture, lines: Scanlines, record: ShapeRecord): void {
  rasterizeShape(record.shape, lines, picture.width, picture.height);
  paint(picture, lines, record.color, record.alpha);
}

/**
 * Run the given climbs for one attempt at shape number `shapeIndex` (its
 * `retry`-th attempt) and return the best.
 *
 * Each climb's random numbers come only from (seed, shapeIndex, retry,
 * climb index), never from anything about this searcher, so the outcome is
 * the same however the climbs are split between workers.
 */
export function runClimbs(searcher: Searcher, shapeIndex: number, retry: number, climbs: number[]): SearchOutcome {
  if (!searcher.errorGrid) searcher.errorGrid = computeErrorGrid(searcher.picture);
  const input = { ...searcher, errorGrid: searcher.errorGrid };
  let best: SearchOutcome | null = null;
  let evaluations = 0;
  for (const climbIndex of climbs) {
    const rng = createRng(searcher.config.seed, shapeIndex, retry, climbIndex);
    const result = climb(input, rng);
    evaluations += result.evaluations;
    const outcome: SearchOutcome = { shape: result.shape, total: result.total, climb: climbIndex, evaluations: 0 };
    if (best === null || isBetter(outcome, best)) best = outcome;
  }
  if (best === null) throw new Error('runClimbs needs at least one climb');
  best.evaluations = evaluations;
  return best;
}

/** Lower total wins; on a tie, the lower climb index wins. */
export function isBetter(a: SearchOutcome, b: SearchOutcome): boolean {
  return a.total < b.total || (a.total === b.total && a.climb < b.climb);
}

/** Combine outcomes from several workers into the overall best. */
export function pickBest(outcomes: SearchOutcome[]): SearchOutcome {
  let best = outcomes[0];
  let evaluations = 0;
  for (const outcome of outcomes) {
    evaluations += outcome.evaluations;
    if (isBetter(outcome, best)) best = outcome;
  }
  return { ...best, evaluations };
}

/** Which climbs worker `workerIndex` of `workerCount` runs: every workerCount-th one. */
export function climbsForWorker(climbs: number, workerIndex: number, workerCount: number): number[] {
  const indices: number[] = [];
  for (let c = workerIndex; c < climbs; c += workerCount) indices.push(c);
  return indices;
}
