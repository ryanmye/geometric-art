import type { Bitmap } from '../engine/types';
import { MAX_MESH_SIZE } from './predicates';
import type { MeshConfig } from './types';

export const DEFAULT_MESH_CONFIG: MeshConfig = {
  seed: 1,
  points: 300,
  borderDensity: 0.25,
  generations: 500,
  jumpRate: 0.2,
  tolerance: 0.5,
};

/**
 * Defaults for polygon cells (Voronoi mosaic): the triangle defaults with
 * cells: 'polygons' and more points, since a polygon mesh of n points has n
 * cells against about 2n triangles. Same presets (MESH_QUALITY_PRESETS).
 */
export const MESH_POLYGON_DEFAULTS: MeshConfig = {
  ...DEFAULT_MESH_CONFIG,
  points: 600,
  cells: 'polygons',
};

export type MeshQuality = 'draft' | 'standard' | 'fine';

/**
 * How long to optimise. Only the number of generations differs.
 *
 * From runs on the 171x256 Mona Lisa with 300 points (one thread, Node,
 * seeds 1 and 2; error as in RunResult.score):
 *   draft       100 generations   ~0.25 s   error ~0.032
 *   standard    500 generations   ~0.7 s    error ~0.0306
 *   fine       2000 generations   ~2.7 s    error ~0.0294
 */
export const MESH_QUALITY_PRESETS: Record<MeshQuality, Pick<MeshConfig, 'generations'>> = {
  draft: { generations: 100 },
  standard: { generations: 500 },
  fine: { generations: 2000 },
};

/** The fewest points a mesh can have. */
export const MIN_MESH_POINTS = 8;

/**
 * The most points a mesh can have on a width x height target: points sit on
 * whole-pixel positions, so one per pixel corner, (width + 1) * (height + 1).
 */
export function maxMeshPoints(width: number, height: number): number {
  return (width + 1) * (height + 1);
}

/** Throw a readable error if the config cannot be used with this target. */
export function checkMeshConfig(target: Bitmap, config: MeshConfig): void {
  const { width, height } = target;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2) {
    throw new Error(`The target must be at least 2x2 pixels (got ${width}x${height})`);
  }
  if (width > MAX_MESH_SIZE || height > MAX_MESH_SIZE) {
    throw new Error(`The target can be at most ${MAX_MESH_SIZE} pixels wide and high (got ${width}x${height})`);
  }
  if (target.data.length !== width * height * 4) throw new Error('Target data has the wrong length');
  if (!Number.isInteger(config.seed) || config.seed < 0 || config.seed > 0xffffffff) {
    throw new Error('seed must be an integer from 0 to 4294967295');
  }
  const room = maxMeshPoints(width, height);
  if (!Number.isInteger(config.points) || config.points < MIN_MESH_POINTS || config.points > room) {
    throw new Error(`points must be a whole number from ${MIN_MESH_POINTS} to ${room} for a ${width}x${height} target`);
  }
  if (!(config.borderDensity >= 0 && config.borderDensity <= 4)) throw new Error('borderDensity must be from 0 to 4');
  if (!Number.isInteger(config.generations) || config.generations < 0) {
    throw new Error('generations must be a whole number, 0 or more');
  }
  if (!(config.jumpRate >= 0 && config.jumpRate <= 1)) throw new Error('jumpRate must be from 0 to 1');
  if (!(config.tolerance >= 0 && config.tolerance <= 100)) throw new Error('tolerance must be from 0 to 100');
  if (config.cells !== undefined && config.cells !== 'triangles' && config.cells !== 'polygons') {
    throw new Error(`cells must be 'triangles' or 'polygons', got ${String(config.cells)}`);
  }
}
