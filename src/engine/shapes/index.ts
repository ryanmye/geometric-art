// One entry point per job (create, mutate, rasterize) that picks the right
// function for the shape's type.

import type { Shape, ShapeType } from '../types';
import type { Rng } from '../rng';
import type { Scanlines } from '../scanlines';
import type { ShapeContext } from './context';
import { mutateEllipse, randomEllipse, rasterizeEllipse } from './ellipse';
import { mutateRectangle, randomRectangle, rasterizeRectangle } from './rectangle';
import { mutateRotatedEllipse, randomRotatedEllipse, rasterizeRotatedEllipse } from './rotatedEllipse';
import { mutateRotatedRectangle, randomRotatedRectangle, rasterizeRotatedRectangle } from './rotatedRectangle';
import { mutateTriangle, randomTriangle, rasterizeTriangle } from './triangle';

export { createShapeContext, type ShapeContext } from './context';

/** A new random shape of the given type placed around (x, y). */
export function randomShape(type: ShapeType, ctx: ShapeContext, rng: Rng, x: number, y: number): Shape {
  switch (type) {
    case 'triangle':
      return randomTriangle(ctx, rng, x, y);
    case 'rectangle':
      return randomRectangle(ctx, rng, x, y);
    case 'rotatedRectangle':
      return randomRotatedRectangle(ctx, rng, x, y);
    case 'ellipse':
      return randomEllipse(ctx, rng, x, y);
    case 'rotatedEllipse':
      return randomRotatedEllipse(ctx, rng, x, y);
  }
}

/** A slightly changed copy of the shape (the original is not modified). */
export function mutateShape(shape: Shape, ctx: ShapeContext, rng: Rng): Shape {
  switch (shape.type) {
    case 'triangle':
      return mutateTriangle(ctx, rng, shape);
    case 'rectangle':
      return mutateRectangle(ctx, rng, shape);
    case 'rotatedRectangle':
      return mutateRotatedRectangle(ctx, rng, shape);
    case 'ellipse':
      return mutateEllipse(ctx, rng, shape);
    case 'rotatedEllipse':
      return mutateRotatedEllipse(ctx, rng, shape);
  }
}

/**
 * Fill `lines` with the pixels whose centres are inside the shape, clipped
 * to a width x height image.
 */
export function rasterizeShape(shape: Shape, lines: Scanlines, width: number, height: number): void {
  switch (shape.type) {
    case 'triangle':
      return rasterizeTriangle(shape, lines, width, height);
    case 'rectangle':
      return rasterizeRectangle(shape, lines, width, height);
    case 'rotatedRectangle':
      return rasterizeRotatedRectangle(shape, lines, width, height);
    case 'ellipse':
      return rasterizeEllipse(shape, lines, width, height);
    case 'rotatedEllipse':
      return rasterizeRotatedEllipse(shape, lines, width, height);
  }
}
