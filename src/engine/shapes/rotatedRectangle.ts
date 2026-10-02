import type { Shape } from '../types';
import type { Rng } from '../rng';
import type { Scanlines } from '../scanlines';
import { sinCosDegrees } from './trig';
import { ANGLE_STEP, clamp, MUTATION_STEP, START_SIZE, wrapDegrees, type ShapeContext } from './context';
import { rasterizeConvexPolygon } from './polygon';

type RotatedRectangle = Extract<Shape, { type: 'rotatedRectangle' }>;

/** Primitive's validity rule: the long side at most 5 times the short side. */
const MAX_ASPECT = 5;
const MIN_SIDE = 1;

/** A random rotated rectangle centred at (x, y). */
export function randomRotatedRectangle(ctx: ShapeContext, rng: Rng, x: number, y: number): RotatedRectangle {
  const w = Math.max(MIN_SIDE, rng.range(1, START_SIZE) * ctx.unit);
  // Pick h within the allowed aspect range of w so the start is valid.
  const h = clamp(rng.range(1, START_SIZE) * ctx.unit, Math.max(MIN_SIDE, w / MAX_ASPECT), w * MAX_ASPECT);
  const start: RotatedRectangle = {
    type: 'rotatedRectangle',
    cx: clamp(x, 0, ctx.width),
    cy: clamp(y, 0, ctx.height),
    w,
    h,
    angle: rng.range(0, 360),
  };
  // Primitive mutates once after creating.
  return mutateRotatedRectangle(ctx, rng, start);
}

/** Move the centre, resize, or turn, repeating until the aspect rule holds. */
export function mutateRotatedRectangle(ctx: ShapeContext, rng: Rng, r: RotatedRectangle): RotatedRectangle {
  const step = MUTATION_STEP * ctx.unit;
  const maxSide = Math.max(ctx.width, ctx.height);
  for (let tries = 0; tries < 100; tries++) {
    const next = { ...r };
    const choice = rng.int(0, 2);
    if (choice === 0) {
      next.cx = clamp(r.cx + rng.normal() * step, 0, ctx.width);
      next.cy = clamp(r.cy + rng.normal() * step, 0, ctx.height);
    } else if (choice === 1) {
      next.w = clamp(r.w + rng.normal() * step, MIN_SIDE, maxSide);
      next.h = clamp(r.h + rng.normal() * step, MIN_SIDE, maxSide);
    } else {
      next.angle = wrapDegrees(r.angle + rng.normal() * ANGLE_STEP);
    }
    if (isValidRotatedRectangle(next)) return next;
  }
  return r;
}

export function isValidRotatedRectangle(r: RotatedRectangle): boolean {
  const long = Math.max(r.w, r.h);
  const short = Math.min(r.w, r.h);
  return short >= MIN_SIDE && long / short <= MAX_ASPECT;
}

const corners = new Float64Array(8);

export function rasterizeRotatedRectangle(
  r: RotatedRectangle,
  lines: Scanlines,
  width: number,
  height: number,
): void {
  // Corners of the unrotated rectangle relative to its centre, turned by
  // `angle` clockwise on screen. With y pointing down, that rotation is
  //   x' = x cos(a) - y sin(a),  y' = x sin(a) + y cos(a).
  const [sin, cos] = sinCosDegrees(r.angle);
  const hw = r.w / 2;
  const hh = r.h / 2;
  setCorner(0, r, -hw, -hh, cos, sin);
  setCorner(1, r, hw, -hh, cos, sin);
  setCorner(2, r, hw, hh, cos, sin);
  setCorner(3, r, -hw, hh, cos, sin);
  rasterizeConvexPolygon(corners, 4, lines, width, height);
}

function setCorner(i: number, r: RotatedRectangle, x: number, y: number, cos: number, sin: number): void {
  corners[2 * i] = r.cx + x * cos - y * sin;
  corners[2 * i + 1] = r.cy + x * sin + y * cos;
}
