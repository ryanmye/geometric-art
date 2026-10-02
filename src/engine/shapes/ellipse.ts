import type { Shape } from '../types';
import type { Rng } from '../rng';
import { addSpan, rowRange, type Scanlines } from '../scanlines';
import { clamp, MUTATION_STEP, START_SIZE, type ShapeContext } from './context';

type Ellipse = Extract<Shape, { type: 'ellipse' }>;

// Radii are at least 1 and the centre stays on the image, so an ellipse
// always covers at least the pixel its centre is in.
const MIN_RADIUS = 1;

/** A random axis-aligned ellipse centred at (x, y). */
export function randomEllipse(ctx: ShapeContext, rng: Rng, x: number, y: number): Ellipse {
  return {
    type: 'ellipse',
    cx: clamp(x, 0, ctx.width),
    cy: clamp(y, 0, ctx.height),
    rx: Math.max(MIN_RADIUS, rng.range(1, START_SIZE) * ctx.unit),
    ry: Math.max(MIN_RADIUS, rng.range(1, START_SIZE) * ctx.unit),
  };
}

/** Move the centre, or change one radius (primitive's three moves). */
export function mutateEllipse(ctx: ShapeContext, rng: Rng, e: Ellipse): Ellipse {
  const step = MUTATION_STEP * ctx.unit;
  const next = { ...e };
  const choice = rng.int(0, 2);
  if (choice === 0) {
    next.cx = clamp(e.cx + rng.normal() * step, 0, ctx.width);
    next.cy = clamp(e.cy + rng.normal() * step, 0, ctx.height);
  } else if (choice === 1) {
    next.rx = clamp(e.rx + rng.normal() * step, MIN_RADIUS, ctx.width);
  } else {
    next.ry = clamp(e.ry + rng.normal() * step, MIN_RADIUS, ctx.height);
  }
  return next;
}

export function rasterizeEllipse(e: Ellipse, lines: Scanlines, width: number, height: number): void {
  lines.count = 0;
  const [firstRow, lastRow] = rowRange(e.cy - e.ry, e.cy + e.ry, height);
  for (let row = firstRow; row <= lastRow; row++) {
    // On the line y = row + 0.5 the ellipse (x-cx)^2/rx^2 + (y-cy)^2/ry^2 <= 1
    // spans cx +- rx * sqrt(1 - ((y-cy)/ry)^2).
    const dy = (row + 0.5 - e.cy) / e.ry;
    const t = 1 - dy * dy;
    if (t < 0) continue;
    const half = e.rx * Math.sqrt(t);
    addSpan(lines, row, e.cx - half, e.cx + half, width);
  }
}
