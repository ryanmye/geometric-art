// The mesh styles' point count, fitted to the picture.
//
// A mesh's points sit on whole-pixel positions, so a small picture can only
// hold so many (maxMeshPoints in src/mesh). Rather than refusing to start,
// the page uses the most the picture can hold and says so. The mesh engine
// itself (and the scripts) stay strict.

import { MIN_MESH_POINTS, maxMeshPoints, type MeshConfig } from '../../mesh';

export interface FittedPoints {
  /** The config to run, with the number of points it can actually use. */
  config: MeshConfig;
  /** What was asked for. */
  requested: number;
  /** The most points this picture can hold. */
  limit: number;
  /** True when fewer points than asked for are used. */
  reduced: boolean;
}

/**
 * Fit the requested number of points to a width x height working image.
 * Throws a readable error if the picture is too small for even the fewest
 * points a mesh needs.
 */
export function fitMeshPoints(config: MeshConfig, width: number, height: number): FittedPoints {
  const limit = maxMeshPoints(width, height);
  if (limit < MIN_MESH_POINTS) {
    throw new Error(
      `This picture is too small for a mesh (${width} x ${height} pixels at this working size). ` +
        'Try a larger working size or another style.',
    );
  }
  const points = Math.min(config.points, limit);
  return { config: points === config.points ? config : { ...config, points }, requested: config.points, limit, reduced: points < config.points };
}

/** The quiet note shown when the points were reduced, or null. */
export function pointsNote(fitted: FittedPoints): string | null {
  return fitted.reduced
    ? `This picture can hold at most ${fitted.limit} points, so ${fitted.limit} were used instead of ${fitted.requested}.`
    : null;
}
