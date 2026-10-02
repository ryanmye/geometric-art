import { describe, expect, it } from 'vitest';
import type { Shape, ShapeType } from '../../src/engine/types';
import { SHAPE_TYPES } from '../../src/engine/types';
import { createScanlines } from '../../src/engine/scanlines';
import { createShapeContext, mutateShape, randomShape, rasterizeShape } from '../../src/engine/shapes';
import { createRng } from '../../src/engine/rng';

const WIDTH = 40;
const HEIGHT = 30;

/**
 * Brute force: how far inside the shape is point (x, y)? Positive inside,
 * negative outside, roughly in pixels near the edge. Written independently
 * of the rasterizers.
 */
function insideness(shape: Shape, x: number, y: number): number {
  switch (shape.type) {
    case 'triangle': {
      const pts = [shape.x1, shape.y1, shape.x2, shape.y2, shape.x3, shape.y3];
      return convexInsideness(pts, x, y);
    }
    case 'rectangle':
      return Math.min(x - shape.x1, shape.x2 - x, y - shape.y1, shape.y2 - y);
    case 'rotatedRectangle': {
      const [u, v] = toLocal(x - shape.cx, y - shape.cy, shape.angle);
      return Math.min(shape.w / 2 - Math.abs(u), shape.h / 2 - Math.abs(v));
    }
    case 'ellipse':
      return 1 - ((x - shape.cx) / shape.rx) ** 2 - ((y - shape.cy) / shape.ry) ** 2;
    case 'rotatedEllipse': {
      const [u, v] = toLocal(x - shape.cx, y - shape.cy, shape.angle);
      return 1 - (u / shape.rx) ** 2 - (v / shape.ry) ** 2;
    }
  }
}

/** Undo a clockwise-on-screen rotation by `degrees`. */
function toLocal(dx: number, dy: number, degrees: number): [number, number] {
  const a = (degrees * Math.PI) / 180;
  return [dx * Math.cos(a) + dy * Math.sin(a), -dx * Math.sin(a) + dy * Math.cos(a)];
}

/** Signed distance-like test for a convex polygon in either winding order. */
function convexInsideness(pts: number[], x: number, y: number): number {
  const n = pts.length / 2;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += pts[2 * i] * pts[2 * j + 1] - pts[2 * j] * pts[2 * i + 1];
  }
  const sign = area >= 0 ? 1 : -1;
  let smallest = Infinity;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ex = pts[2 * j] - pts[2 * i];
    const ey = pts[2 * j + 1] - pts[2 * i + 1];
    const cross = ex * (y - pts[2 * i + 1]) - ey * (x - pts[2 * i]);
    smallest = Math.min(smallest, (sign * cross) / Math.hypot(ex, ey));
  }
  return smallest;
}

/** Compare the rasterizer with the brute-force test at every pixel centre. */
function checkShape(shape: Shape): number {
  const lines = createScanlines(HEIGHT);
  rasterizeShape(shape, lines, WIDTH, HEIGHT);
  const covered = new Uint8Array(WIDTH * HEIGHT);
  const rowsSeen = new Set<number>();
  for (let k = 0; k < lines.count; k++) {
    const [y, x1, x2] = [lines.data[3 * k], lines.data[3 * k + 1], lines.data[3 * k + 2]];
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y).toBeLessThan(HEIGHT);
    expect(x1).toBeGreaterThanOrEqual(0);
    expect(x2).toBeLessThan(WIDTH);
    expect(x1).toBeLessThanOrEqual(x2);
    expect(rowsSeen.has(y)).toBe(false);
    rowsSeen.add(y);
    for (let x = x1; x <= x2; x++) covered[y * WIDTH + x] = 1;
  }
  let checked = 0;
  for (let py = 0; py < HEIGHT; py++) {
    for (let px = 0; px < WIDTH; px++) {
      const d = insideness(shape, px + 0.5, py + 0.5);
      if (Math.abs(d) < 1e-9) continue; // exactly on the edge: either answer is fine
      const expected = d > 0 ? 1 : 0;
      if (covered[py * WIDTH + px] !== expected) {
        throw new Error(`pixel (${px}, ${py}) wrong for ${JSON.stringify(shape)}: inside=${d}`);
      }
      checked++;
    }
  }
  return checked;
}

describe('rasterizers match a brute-force pixel-centre test', () => {
  const ctx = createShapeContext(WIDTH, HEIGHT);
  // Make shapes bigger than usual relative to this small image.
  const bigCtx = { ...ctx, unit: 1 };

  for (const type of SHAPE_TYPES) {
    it(type, () => {
      const rng = createRng(123, SHAPE_TYPES.indexOf(type));
      let shapes = 0;
      for (let i = 0; i < 300; i++) {
        let shape = randomShape(type as ShapeType, bigCtx, rng, rng.range(-5, WIDTH + 5), rng.range(-5, HEIGHT + 5));
        for (let m = rng.int(0, 5); m > 0; m--) shape = mutateShape(shape, bigCtx, rng);
        checkShape(shape);
        shapes++;
      }
      expect(shapes).toBe(300);
    });
  }

  it('hand-picked shapes, including ones hanging off the edges', () => {
    const shapes: Shape[] = [
      { type: 'triangle', x1: -10, y1: 5, x2: 30, y2: -8, x3: 20, y3: 40 },
      { type: 'triangle', x1: 3.2, y1: 4.7, x2: 15.1, y2: 4.7, x3: 9.9, y3: 20.3 }, // flat top edge
      { type: 'rectangle', x1: 2, y1: 3, x2: 5, y2: 7 }, // integer edges: centres 2.5..4.5 and 3.5..6.5
      { type: 'rectangle', x1: 35.3, y1: -4, x2: 40, y2: 2.2 },
      { type: 'rotatedRectangle', cx: 20, cy: 15, w: 30, h: 6, angle: 30 },
      { type: 'rotatedRectangle', cx: 0, cy: 30, w: 12, h: 9, angle: 100 },
      { type: 'ellipse', cx: 20.3, cy: 15.2, rx: 12.5, ry: 4.1 },
      { type: 'ellipse', cx: 40, cy: 0, rx: 9, ry: 9 },
      { type: 'rotatedEllipse', cx: 20.3, cy: 15.2, rx: 18, ry: 3.5, angle: 33 },
      { type: 'rotatedEllipse', cx: 5, cy: 25, rx: 10, ry: 4, angle: 290 },
    ];
    for (const shape of shapes) expect(checkShape(shape)).toBeGreaterThan(0);
  });

  it('a 3 x 4 rectangle with integer corners covers exactly 12 pixels', () => {
    const lines = createScanlines(HEIGHT);
    rasterizeShape({ type: 'rectangle', x1: 2, y1: 3, x2: 5, y2: 7 }, lines, WIDTH, HEIGHT);
    expect(Array.from(lines.data.slice(0, lines.count * 3))).toEqual([3, 2, 4, 4, 2, 4, 5, 2, 4, 6, 2, 4]);
  });
});
