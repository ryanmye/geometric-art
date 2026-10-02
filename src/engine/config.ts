import type { RunConfig } from './types';

export const DEFAULT_CONFIG: RunConfig = {
  seed: 1,
  shapeTypes: ['triangle'],
  alpha: 128,
  maxShapes: 300,
  climbs: 16,
  candidates: 100,
  maxAge: 200,
  errorBias: 0.8,
};

export type Quality = 'draft' | 'standard' | 'fine';

/**
 * How hard to search for each shape. More effort gives better shapes, slower.
 *
 * Chosen from a sweep on the 256 px Mona Lisa (300 triangles, one thread):
 * a longer hill climb (maxAge) buys the most per unit of time, extra random
 * candidates the least. Climbs run in parallel on the worker pool, so they
 * are kept at multiples of 8 to share evenly between typical pools.
 *   (climbs x candidates x maxAge; average ms/shape over 300 shapes; final error)
 *   draft      8 x  50 x 100    21 ms/shape on one thread, error 0.0290
 *   standard  16 x 100 x 200    78 ms/shape,               error 0.0276
 *   fine      32 x 100 x 300   230 ms/shape,               error 0.0266
 * The old standard (16 x 200 x 100) took 42 ms/shape for error 0.0282.
 */
export const QUALITY_PRESETS: Record<Quality, Pick<RunConfig, 'climbs' | 'candidates' | 'maxAge'>> = {
  draft: { climbs: 8, candidates: 50, maxAge: 100 },
  standard: { climbs: 16, candidates: 100, maxAge: 200 },
  fine: { climbs: 32, candidates: 100, maxAge: 300 },
};
