// The search for one shape: one "climb".
//
// 1. Try `candidates` random shapes and keep the best.
// 2. Hill climb: repeatedly make a small random change to the best shape and
//    keep it if it scores better, until `maxAge` changes in a row have failed.
//
// Lower total is better (see score.ts). A shape's colour is never searched
// for; it is always the best colour for its pixels (see color.ts).

import type { RunConfig, Shape } from './types';
import type { Picture } from './picture';
import type { Rng } from './rng';
import type { Scanlines } from './scanlines';
import { computeColor } from './color';
import { sampleErrorGrid, type ErrorGrid } from './errorGrid';
import { totalAfterShape } from './score';
import { mutateShape, rasterizeShape, randomShape, type ShapeContext } from './shapes';

/** Everything a climb reads; nothing in here is changed by a climb. */
export interface ClimbInput {
  picture: Picture;
  config: RunConfig;
  shapeContext: ShapeContext;
  errorGrid: ErrorGrid;
  /** Scratch space for rasterizing, reused for every shape. */
  lines: Scanlines;
}

export interface ClimbResult {
  shape: Shape;
  /** Picture total if this shape were painted (lower is better). */
  total: number;
  /** How many shapes were scored, for speed statistics. */
  evaluations: number;
}

export function climb(input: ClimbInput, rng: Rng): ClimbResult {
  const { config } = input;
  let evaluations = 0;

  // 1. Best of many random shapes.
  let bestShape = randomCandidate(input, rng);
  let bestTotal = scoreShape(input, bestShape);
  evaluations++;
  for (let i = 1; i < config.candidates; i++) {
    const shape = randomCandidate(input, rng);
    const total = scoreShape(input, shape);
    evaluations++;
    if (total < bestTotal) {
      bestShape = shape;
      bestTotal = total;
    }
  }

  // 2. Hill climb from it.
  let age = 0;
  while (age < config.maxAge) {
    const shape = mutateShape(bestShape, input.shapeContext, rng);
    const total = scoreShape(input, shape);
    evaluations++;
    if (total < bestTotal) {
      bestShape = shape;
      bestTotal = total;
      age = 0;
    } else {
      age++;
    }
  }

  return { shape: bestShape, total: bestTotal, evaluations };
}

/**
 * A random shape of one of the allowed types. With probability `errorBias`
 * it is placed where the error grid says the picture is worst; otherwise
 * anywhere on the image.
 */
function randomCandidate(input: ClimbInput, rng: Rng): Shape {
  const { config, picture, shapeContext } = input;
  const type = config.shapeTypes[rng.int(0, config.shapeTypes.length - 1)];
  let x: number;
  let y: number;
  if (rng.next() < config.errorBias) {
    [x, y] = sampleErrorGrid(input.errorGrid, rng, picture.width, picture.height);
  } else {
    x = rng.next() * picture.width;
    y = rng.next() * picture.height;
  }
  return randomShape(type, shapeContext, rng, x, y);
}

/**
 * The picture total if `shape` were painted in its best colour. A shape that
 * covers no pixel leaves the total unchanged, so it can never win.
 */
export function scoreShape(input: ClimbInput, shape: Shape): number {
  const { picture, lines } = input;
  rasterizeShape(shape, lines, picture.width, picture.height);
  if (lines.count === 0) return picture.total;
  const color = computeColor(picture, lines, input.config.alpha);
  return totalAfterShape(picture, lines, color, input.config.alpha);
}
