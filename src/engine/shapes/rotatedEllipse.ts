import type { Shape } from '../types';
import type { Rng } from '../rng';
import { addSpan, rowRange, type Scanlines } from '../scanlines';
import { sinCosDegrees } from './trig';
import { ANGLE_STEP, clamp, MUTATION_STEP, START_SIZE, wrapDegrees, type ShapeContext } from './context';

type RotatedEllipse = Extract<Shape, { type: 'rotatedEllipse' }>;

const MIN_RADIUS = 1;

/** A random rotated ellipse centred at (x, y). */
export function randomRotatedEllipse(ctx: ShapeContext, rng: Rng, x: number, y: number): RotatedEllipse {
  return {
    type: 'rotatedEllipse',
    cx: clamp(x, 0, ctx.width),
    cy: clamp(y, 0, ctx.height),
    rx: Math.max(MIN_RADIUS, rng.range(1, START_SIZE) * ctx.unit),
    ry: Math.max(MIN_RADIUS, rng.range(1, START_SIZE) * ctx.unit),
    angle: rng.range(0, 360),
  };
}

/** Move the centre, change both radii, or turn (primitive's three moves). */
export function mutateRotatedEllipse(ctx: ShapeContext, rng: Rng, e: RotatedEllipse): RotatedEllipse {
  const step = MUTATION_STEP * ctx.unit;
  const maxRadius = Math.max(ctx.width, ctx.height);
  const next = { ...e };
  const choice = rng.int(0, 2);
  if (choice === 0) {
    next.cx = clamp(e.cx + rng.normal() * step, 0, ctx.width);
    next.cy = clamp(e.cy + rng.normal() * step, 0, ctx.height);
  } else if (choice === 1) {
    next.rx = clamp(e.rx + rng.normal() * step, MIN_RADIUS, maxRadius);
    next.ry = clamp(e.ry + rng.normal() * step, MIN_RADIUS, maxRadius);
  } else {
    next.angle = wrapDegrees(e.angle + rng.normal() * ANGLE_STEP);
  }
  return next;
}

export function rasterizeRotatedEllipse(e: RotatedEllipse, lines: Scanlines, width: number, height: number): void {
  lines.count = 0;
  const [sin, cos] = sinCosDegrees(e.angle);

  // A point at offset (dx, dy) from the centre is inside when, after turning
  // it back by `angle` into the ellipse's own axes,
  //   u = dx cos + dy sin,   v = -dx sin + dy cos,   u^2/rx^2 + v^2/ry^2 <= 1.
  // For a fixed row (fixed dy) that is a quadratic in dx:
  //   A dx^2 + B dx + C <= 0
  // and the covered span lies between its two roots.
  const irx2 = 1 / (e.rx * e.rx);
  const iry2 = 1 / (e.ry * e.ry);
  const A = cos * cos * irx2 + sin * sin * iry2;
  const Bperdy = 2 * cos * sin * (irx2 - iry2);
  const Cperdy2 = sin * sin * irx2 + cos * cos * iry2;

  // Half the height of the ellipse's bounding box.
  const halfHeight = Math.sqrt(e.rx * e.rx * sin * sin + e.ry * e.ry * cos * cos);
  const [firstRow, lastRow] = rowRange(e.cy - halfHeight, e.cy + halfHeight, height);
  for (let row = firstRow; row <= lastRow; row++) {
    const dy = row + 0.5 - e.cy;
    const B = Bperdy * dy;
    const C = Cperdy2 * dy * dy - 1;
    const discriminant = B * B - 4 * A * C;
    if (discriminant < 0) continue;
    const root = Math.sqrt(discriminant);
    const left = (-B - root) / (2 * A);
    const right = (-B + root) / (2 * A);
    addSpan(lines, row, e.cx + left, e.cx + right, width);
  }
}
