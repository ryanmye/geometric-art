import type { Shape } from '../types';
import type { Rng } from '../rng';
import type { Scanlines } from '../scanlines';
import { clamp, MUTATION_STEP, type ShapeContext } from './context';
import { rasterizeConvexPolygon } from './polygon';

type Triangle = Extract<Shape, { type: 'triangle' }>;

/**
 * Primitive rejects triangles with any angle of 15 degrees or less (slivers).
 * We compare cosines instead of angles: cos(15 degrees), written out so it is
 * the same number in every JavaScript engine.
 */
const MAX_COS = 0.9659258262890683;
/** Corners may stray this far (at 256 px) outside the image, as in primitive. */
const MARGIN = 16;

/** A random triangle whose corners lie within about 15 px of (x, y). */
export function randomTriangle(ctx: ShapeContext, rng: Rng, x: number, y: number): Triangle {
  const r = 15 * ctx.unit;
  const start: Triangle = {
    type: 'triangle',
    x1: x + rng.range(-r, r),
    y1: y + rng.range(-r, r),
    x2: x + rng.range(-r, r),
    y2: y + rng.range(-r, r),
    x3: x + rng.range(-r, r),
    y3: y + rng.range(-r, r),
  };
  // Like primitive, nudge the corners until the triangle is valid.
  return mutateUntilValid(ctx, rng, start) ?? fallbackTriangle(ctx, x, y);
}

/**
 * A plain valid triangle centred on (x, y) moved onto the image, for the
 * practically unreachable case where random tries keep failing. Corners at
 * (0, -r), (-r, r/2), (r, r/2) around the centre: their average is the
 * centre itself, and the angles are about 56, 56 and 68 degrees.
 */
export function fallbackTriangle(ctx: ShapeContext, x: number, y: number): Triangle {
  const r = 15 * ctx.unit;
  const cx = clamp(x, 0, ctx.width);
  const cy = clamp(y, 0, ctx.height);
  return { type: 'triangle', x1: cx, y1: cy - r, x2: cx - r, y2: cy + r / 2, x3: cx + r, y3: cy + r / 2 };
}

/** Move one corner by a random step, repeating until the triangle is valid. */
export function mutateTriangle(ctx: ShapeContext, rng: Rng, t: Triangle): Triangle {
  return mutateUntilValid(ctx, rng, t) ?? t;
}

function mutateUntilValid(ctx: ShapeContext, rng: Rng, start: Triangle): Triangle | null {
  const step = MUTATION_STEP * ctx.unit;
  const m = MARGIN * ctx.unit;
  let t = start;
  for (let tries = 0; tries < 1000; tries++) {
    const corner = rng.int(0, 2);
    const dx = rng.normal() * step;
    const dy = rng.normal() * step;
    t = { ...t };
    if (corner === 0) {
      t.x1 = clamp(t.x1 + dx, -m, ctx.width + m);
      t.y1 = clamp(t.y1 + dy, -m, ctx.height + m);
    } else if (corner === 1) {
      t.x2 = clamp(t.x2 + dx, -m, ctx.width + m);
      t.y2 = clamp(t.y2 + dy, -m, ctx.height + m);
    } else {
      t.x3 = clamp(t.x3 + dx, -m, ctx.width + m);
      t.y3 = clamp(t.y3 + dy, -m, ctx.height + m);
    }
    t = moveCentroidOntoImage(ctx, t);
    if (isValidTriangle(ctx, t)) return t;
  }
  return null;
}

/**
 * If the triangle's centroid (the average of its corners) is off the image,
 * slide the whole triangle so the centroid is on the nearest image edge.
 * Rejecting such triangles instead would make mutation very slow on long
 * thin images, where the step size follows the long side.
 */
function moveCentroidOntoImage(ctx: ShapeContext, t: Triangle): Triangle {
  const cx = (t.x1 + t.x2 + t.x3) / 3;
  const cy = (t.y1 + t.y2 + t.y3) / 3;
  const dx = clamp(cx, 0, ctx.width) - cx;
  const dy = clamp(cy, 0, ctx.height) - cy;
  if (dx === 0 && dy === 0) return t;
  return { type: 'triangle', x1: t.x1 + dx, y1: t.y1 + dy, x2: t.x2 + dx, y2: t.y2 + dy, x3: t.x3 + dx, y3: t.y3 + dy };
}

/**
 * Valid when every angle is more than 15 degrees (no slivers) and the
 * centroid is on the image (so the triangle is at least partly visible).
 */
export function isValidTriangle(ctx: ShapeContext, t: Triangle): boolean {
  const cx = (t.x1 + t.x2 + t.x3) / 3;
  const cy = (t.y1 + t.y2 + t.y3) / 3;
  if (cx < 0 || cx > ctx.width || cy < 0 || cy > ctx.height) return false;
  return (
    angleIsWide(t.x1, t.y1, t.x2, t.y2, t.x3, t.y3) &&
    angleIsWide(t.x2, t.y2, t.x3, t.y3, t.x1, t.y1) &&
    angleIsWide(t.x3, t.y3, t.x1, t.y1, t.x2, t.y2)
  );
}

/** Is the angle at corner (ax, ay), between the edges to b and c, wider than the minimum? */
function angleIsWide(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): boolean {
  const ux = bx - ax;
  const uy = by - ay;
  const vx = cx - ax;
  const vy = cy - ay;
  const lengths = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy));
  if (lengths === 0) return false;
  // cos(angle) = (u . v) / (|u| |v|); a wider angle has a smaller cosine.
  return (ux * vx + uy * vy) / lengths < MAX_COS;
}

const corners = new Float64Array(6);

export function rasterizeTriangle(t: Triangle, lines: Scanlines, width: number, height: number): void {
  corners[0] = t.x1;
  corners[1] = t.y1;
  corners[2] = t.x2;
  corners[3] = t.y2;
  corners[4] = t.x3;
  corners[5] = t.y3;
  rasterizeConvexPolygon(corners, 3, lines, width, height);
}
