// Runs the searches on the calling thread (tests, Node scripts).
//
// `partitions` pretends to be that many workers: the climbs are split between
// that many separate Searchers exactly as the worker pool splits them. The
// output never depends on it; tests use it to check that.

import type { Bitmap, RunConfig, ShapeRecord } from '../engine/types';
import { addRecord, climbsForWorker, createSearcher, pickBest, runClimbs, type Searcher } from '../engine/searcher';
import type { Executor } from './executor';

export function createInlineExecutor(
  target: Bitmap,
  config: RunConfig,
  prefix: ShapeRecord[],
  partitions = 1,
  weights: Uint16Array | null = null,
): Executor {
  const count = Math.max(1, Math.min(partitions, config.climbs));
  let currentConfig = config;
  const searchers: Searcher[] = [];
  for (let i = 0; i < count; i++) searchers.push(createSearcher(target, config, prefix, weights));

  return {
    inline: true,
    async search(shapeIndex, retry) {
      const outcomes = searchers.map((searcher, i) =>
        runClimbs(searcher, shapeIndex, retry, climbsForWorker(currentConfig.climbs, i, count)),
      );
      return pickBest(outcomes);
    },
    reset(newConfig, newPrefix) {
      currentConfig = newConfig;
      for (let i = 0; i < count; i++) searchers[i] = createSearcher(target, newConfig, newPrefix, weights);
    },
    add(record) {
      for (const searcher of searchers) addRecord(searcher, record);
    },
    dispose() {
      searchers.length = 0;
    },
  };
}
