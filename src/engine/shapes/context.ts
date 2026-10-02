// What a shape needs to know about the image it is placed on.

export interface ShapeContext {
  /** Working image size in pixels. */
  width: number;
  height: number;
  /**
   * Size factor: (longest side) / 256. Primitive's sizes and mutation steps
   * were tuned for 256-pixel images; multiplying by this keeps shapes the
   * same relative size at 128 or 512.
   */
  unit: number;
}

export function createShapeContext(width: number, height: number): ShapeContext {
  return { width, height, unit: Math.max(width, height) / 256 };
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Keep an angle in degrees within [0, 360). */
export function wrapDegrees(angle: number): number {
  const wrapped = angle % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/** Standard deviation (in working pixels at 256 px) of a position or size mutation, as in primitive. */
export const MUTATION_STEP = 16;
/** Standard deviation in degrees of an angle mutation, as in primitive. */
export const ANGLE_STEP = 32;
/** New random shapes are up to this many pixels across (at 256 px), as in primitive. */
export const START_SIZE = 32;
