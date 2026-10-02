// The run's picture of record, kept on the calling thread: the current
// picture, its score and the list of accepted shapes.

import type { Bitmap, ImportanceInfo, RGB, RunConfig, RunResult, Shape, ShapeRecord } from './types';
import { averageColor, createPicture, paint, type Picture } from './picture';
import { createScanlines, type Scanlines } from './scanlines';
import { computeColor } from './color';
import { totalAfterShape, totalToScore, weightedTotalToScore } from './score';
import { rasterizeShape } from './shapes';
import { paintRecord } from './searcher';

export interface Model {
  picture: Picture;
  background: RGB;
  config: RunConfig;
  records: ShapeRecord[];
  lines: Scanlines;
  /** How the weights were made (only when there are weights), for the results. */
  importance: ImportanceInfo | null;
}

/**
 * Start from the target's average colour, then paint any prefix shapes.
 * `weights` are whole-number per-pixel weights from integerWeights(), or null.
 */
export function createModel(
  target: Bitmap,
  config: RunConfig,
  prefix: ShapeRecord[] = [],
  weights: Uint16Array | null = null,
  importance: ImportanceInfo = {},
): Model {
  const background = averageColor(target);
  const model: Model = {
    picture: createPicture(target, background, weights),
    background,
    config,
    records: [],
    lines: createScanlines(target.height),
    importance: weights ? { ...importance } : null,
  };
  for (const record of prefix) {
    paintRecord(model.picture, model.lines, record);
    // Keep the given shape, colour and opacity; recompute the score for this target.
    model.records.push({ ...record, score: currentScore(model) });
  }
  return model;
}

/** The plain (unweighted) score, comparable between all runs. */
export function currentScore(model: Model): number {
  return totalToScore(model.picture.plainTotal, model.picture.width, model.picture.height);
}

/**
 * Paint `shape` in its best colour if that lowers the error, and return the
 * new record. Returns null (and changes nothing) if it would not help.
 */
export function addShape(model: Model, shape: Shape): ShapeRecord | null {
  const { picture, lines, config } = model;
  rasterizeShape(shape, lines, picture.width, picture.height);
  if (lines.count === 0) return null;
  const color = computeColor(picture, lines, config.alpha);
  if (totalAfterShape(picture, lines, color, config.alpha) >= picture.total) return null;
  paint(picture, lines, color, config.alpha);
  const record: ShapeRecord = { shape, color, alpha: config.alpha, score: currentScore(model) };
  model.records.push(record);
  return record;
}

/** A snapshot that does not change as the run continues. */
export function modelResult(model: Model): RunResult {
  const result: RunResult = {
    version: 1,
    width: model.picture.width,
    height: model.picture.height,
    background: [model.background[0], model.background[1], model.background[2]],
    config: { ...model.config, shapeTypes: [...model.config.shapeTypes] },
    shapes: model.records.slice(),
    score: currentScore(model),
  };
  // Only runs with weights get these two fields, so other results are unchanged.
  if (model.importance) {
    result.importance = { ...model.importance };
    result.weightedScore = weightedTotalToScore(model.picture.total, model.picture.weightSum);
  }
  return result;
}
