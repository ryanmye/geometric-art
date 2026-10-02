import { SHAPE_TYPES, type Bitmap, type RunConfig } from './types';

/** Throw a readable error if the target or config cannot be used. */
export function checkConfig(target: Bitmap, config: RunConfig): void {
  const { width, height, data } = target;
  if (!(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0)) {
    throw new Error(`Image size must be positive whole numbers, got ${width} x ${height}`);
  }
  if (data.length !== width * height * 4) {
    throw new Error(`Image data has ${data.length} bytes; expected ${width * height * 4}`);
  }
  if (config.shapeTypes.length === 0) throw new Error('Choose at least one shape type');
  for (const type of config.shapeTypes) {
    if (!SHAPE_TYPES.includes(type)) throw new Error(`Unknown shape type "${type}"`);
  }
  requireInteger('alpha', config.alpha, 1, 255);
  requireInteger('seed', config.seed, 0, 0xffffffff);
  requireInteger('maxShapes', config.maxShapes, 0, 1_000_000);
  requireInteger('climbs', config.climbs, 1, 10_000);
  requireInteger('candidates', config.candidates, 1, 1_000_000);
  requireInteger('maxAge', config.maxAge, 0, 1_000_000);
  if (!(config.errorBias >= 0 && config.errorBias <= 1)) {
    throw new Error(`errorBias must be between 0 and 1, got ${config.errorBias}`);
  }
}

function requireInteger(name: string, value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be a whole number from ${min} to ${max}, got ${value}`);
  }
}
