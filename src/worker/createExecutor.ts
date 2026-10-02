// Choose and create the executor a runner will use.

import type { Bitmap, RunConfig, RunnerOptions, ShapeRecord } from '../engine/types';
import type { Executor } from './executor';
import { createInlineExecutor } from './inlineExecutor';
import { createWorkerExecutor } from './workerExecutor';

export function createExecutor(
  target: Bitmap,
  config: RunConfig,
  prefix: ShapeRecord[],
  options: Pick<RunnerOptions, 'executor' | 'workerCount'>,
  weights: Uint16Array | null = null,
): Executor {
  const canUseWorkers = typeof Worker !== 'undefined';
  const kind = options.executor ?? (canUseWorkers ? 'workers' : 'inline');
  if (kind === 'workers') {
    if (!canUseWorkers) throw new Error('Web workers are not available here; use executor: "inline"');
    const hardware = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 0;
    const count = options.workerCount ?? (hardware > 0 ? hardware : 4);
    return createWorkerExecutor(target, config, prefix, count, weights);
  }
  return createInlineExecutor(target, config, prefix, options.workerCount ?? 1, weights);
}
