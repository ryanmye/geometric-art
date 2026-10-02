// createMeshRunner: the public way to run the mesh engine.
//
// Inline, the loop (loop.ts) runs on the calling thread in short slices.
// With a worker, the very same loop runs inside mesh.worker.ts and this
// side only relays messages. Both give identical meshes for the same
// target, config, seed and weights.

import type { Bitmap } from '../engine/types';
import { checkMeshConfig } from './config';
import { createLoop } from './loop';
import { meshResult } from './result';
import { createMeshState } from './state';
import type {
  MeshConfig,
  MeshResult,
  MeshRunner,
  MeshRunnerEvents,
  MeshRunnerOptions,
  MeshRunnerState,
} from './types';
import { weightingFromOptions, type MeshWeighting } from './weights';
import { startMeshWorker } from './workerClient';

export const DEFAULT_PROGRESS_INTERVAL = 100;

/**
 * Create a runner that recreates `target` as a triangle mesh. `target`
 * should already be at working size (longest side around 256 px).
 * Throws at once if the config or weights cannot be used.
 */
export function createMeshRunner(
  target: Bitmap,
  config: MeshConfig,
  events: MeshRunnerEvents = {},
  options: MeshRunnerOptions = {},
): MeshRunner {
  checkMeshConfig(target, config);
  const weighting = weightingFromOptions(options, target.width, target.height);
  const kind = chooseExecutor(options);
  const progressInterval = options.progressInterval ?? DEFAULT_PROGRESS_INTERVAL;
  if (kind === 'worker') return createWorkerRunner(target, config, weighting, events, progressInterval);
  return createInlineRunner(target, config, weighting, events, progressInterval);
}

/** 'worker' or 'inline', from the options and what this environment has. */
export function chooseExecutor(options: MeshRunnerOptions): 'worker' | 'inline' {
  const canUseWorker = typeof Worker !== 'undefined';
  const kind = options.executor ?? (canUseWorker ? 'worker' : 'inline');
  if (kind === 'worker' && !canUseWorker) throw new Error('Web workers are not available here; use executor: "inline"');
  return kind;
}

function createInlineRunner(
  target: Bitmap,
  config: MeshConfig,
  weighting: MeshWeighting | null,
  events: MeshRunnerEvents,
  progressInterval: number,
): MeshRunner {
  const state = createMeshState(target, { ...config }, weighting);
  let runnerState: MeshRunnerState = 'idle';
  let disposed = false;
  const loop = createLoop(state, progressInterval, {
    progress: (result, generation) => events.onProgress?.(result, generation),
    done: (result) => {
      runnerState = 'done';
      events.onDone?.(result);
    },
    error: (error) => {
      runnerState = 'paused';
      events.onError?.(error);
    },
  });

  return {
    get state() {
      return runnerState;
    },
    start() {
      if (disposed) throw new Error('This runner has been disposed');
      if (runnerState === 'done') return;
      runnerState = 'running';
      loop.start();
    },
    pause() {
      if (runnerState !== 'running') return;
      runnerState = 'paused';
      loop.pause();
    },
    result() {
      return meshResult(state);
    },
    dispose() {
      disposed = true;
      if (runnerState === 'running') runnerState = 'paused';
      loop.stop();
    },
  };
}

function createWorkerRunner(
  target: Bitmap,
  config: MeshConfig,
  weighting: MeshWeighting | null,
  events: MeshRunnerEvents,
  progressInterval: number,
): MeshRunner {
  // The starting mesh, built here too (it takes milliseconds) so result()
  // has something to show before the worker first reports.
  let latest: MeshResult = meshResult(createMeshState(target, { ...config }, weighting));
  let runnerState: MeshRunnerState = 'idle';
  let disposed = false;

  const worker = startMeshWorker(
    {
      type: 'init',
      // A plain object, so a canvas ImageData works too.
      target: { width: target.width, height: target.height, data: target.data },
      config: { ...config },
      weighting,
      progressInterval,
      animation: null,
    },
    (message) => {
      if (disposed) return;
      if (message.type === 'progress') {
        latest = message.result;
        events.onProgress?.(message.result, message.generation);
      } else if (message.type === 'done') {
        latest = message.result;
        runnerState = 'done';
        events.onDone?.(message.result);
      }
    },
    (error) => {
      if (disposed) return;
      runnerState = 'paused';
      events.onError?.(error);
    },
  );

  return {
    get state() {
      return runnerState;
    },
    start() {
      if (disposed) throw new Error('This runner has been disposed');
      if (runnerState === 'done') return;
      runnerState = 'running';
      worker.send({ type: 'start' });
    },
    pause() {
      if (runnerState !== 'running') return;
      runnerState = 'paused';
      worker.send({ type: 'pause' });
    },
    result() {
      return latest;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (runnerState === 'running') runnerState = 'paused';
      worker.terminate();
    },
  };
}
