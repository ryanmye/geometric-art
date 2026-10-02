import type { Shape } from '../types';
import type { Rng } from '../rng';
import { addSpan, rowRange, type Scanlines } from '../scanlines';
import { clamp, MUTATION_STEP, START_SIZE, type ShapeContext } from './context';

type Rectangle = Extract<Shape, { type: 'rectangle' }>;

/** Sides shorter than one pixel could cover no pixel centre at all. */
const MIN_SIDE = 1;

/** A random axis-aligned rectangle centred near (x, y), kept inside the image. */
export function randomRectangle(ctx: ShapeContext, rng: Rng, x: number, y: number): Rectangle {
  const w = rng.range(1, START_SIZE) * ctx.unit;
  const h = rng.range(1, START_SIZE) * ctx.unit;
  return fitRectangle(ctx, x - w / 2, y - h / 2, x + w / 2, y + h / 2);
}

/** Move one corner by a random step (primitive moves corner 1 or corner 2). */
export function mutateRectangle(ctx: ShapeContext, rng: Rng, r: Rectangle): Rectangle {
  const step = MUTATION_STEP * ctx.unit;
  let { x1, y1, x2, y2 } = r;
  if (rng.int(0, 1) === 0) {
    x1 += rng.normal() * step;
    y1 += rng.normal() * step;
  } else {
    x2 += rng.normal() * step;
    y2 += rng.normal() * step;
  }
  return fitRectangle(ctx, x1, y1, x2, y2);
}

/** Order the corners so x1 < x2 and y1 < y2, clip to the image, and enforce the minimum size. */
function fitRectangle(ctx: ShapeContext, ax: number, ay: number, bx: number, by: number): Rectangle {
  let x1 = clamp(Math.min(ax, bx), 0, ctx.width);
  let x2 = clamp(Math.max(ax, bx), 0, ctx.width);
  let y1 = clamp(Math.min(ay, by), 0, ctx.height);
  let y2 = clamp(Math.max(ay, by), 0, ctx.height);
  if (x2 - x1 < MIN_SIDE) {
    x1 = Math.min(x1, ctx.width - MIN_SIDE);
    x2 = x1 + MIN_SIDE;
  }
  if (y2 - y1 < MIN_SIDE) {
    y1 = Math.min(y1, ctx.height - MIN_SIDE);
    y2 = y1 + MIN_SIDE;
  }
  return { type: 'rectangle', x1, y1, x2, y2 };
}

export function rasterizeRectangle(r: Rectangle, lines: Scanlines, width: number, height: number): void {
  lines.count = 0;
  const [firstRow, lastRow] = rowRange(r.y1, r.y2, height);
  for (let row = firstRow; row <= lastRow; row++) {
    addSpan(lines, row, r.x1, r.x2, width);
  }
}
