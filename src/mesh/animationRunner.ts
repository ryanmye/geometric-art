// createMeshAnimationRunner: run a mesh seed animation (see animationPlan.ts).
//
// Inline, the animation loop runs on the calling thread. With a worker, one
// worker runs the very same loop for every frame and this side only relays
// messages. Both give identical frames.

import type { Bitmap } from '../engine/types';
import { createAnimationLoop } from './animationLoop';
import { assembleMeshAnimation, checkMeshAnimationSettings } from './animationPlan';
import { checkMeshConfig } from './config';
import { chooseExecutor, DEFAULT_PROGRESS_INTERVAL } from './runner';
import type {
  MeshAnimationEvents,
  MeshAnimationResult,
  MeshAnimationRunner,
  MeshAnimationSettings,
  MeshConfig,
  MeshResult,
  MeshRunnerOptions,
  MeshRunnerState,
} from './types';
import { weightingFromOptions } from './weights';
import { startMeshWorker } from './workerClient';

export function createMeshAnimationRunner(
  target: Bitmap,
  config: MeshConfig,
  settings: MeshAnimationSettings,
  events: MeshAnimationEvents = {},
  options: MeshRunnerOptions = {},
): MeshAnimationRunner {
  checkMeshConfig(target, config);
  checkMeshAnimationSettings(settings);
  const weighting = weightingFromOptions(options, target.width, target.height);
  const kind = chooseExecutor(options);
  const progressInterval = options.progressInterval ?? DEFAULT_PROGRESS_INTERVAL;
  const baseConfig = { ...config };
  const ownSettings = { ...settings };

  let runnerState: MeshRunnerState = 'idle';
  let disposed = false;
  /** Finished frames (as reported, so the same list for both executors). */
  const frames: MeshResult[] = [];
  /** Latest snapshot of the frame being built. */
  let current: MeshResult | null = null;

  // What both executors report, handled the same way.
  const handlers = {
    frameStart(frameIndex: number, seed: number) {
      if (disposed) return;
      // Nothing to show for the new frame until its first progress report.
      current = null;
      events.onFrameStart?.(frameIndex, seed);
    },
    progress(frame: MeshResult, generation: number, frameIndex: number) {
      if (disposed) return;
      // Only a report for the frame being built counts as its snapshot.
      if (frameIndex === frames.length) current = frame;
      events.onProgress?.(frame, generation, frameIndex);
    },
    frameDone(frame: MeshResult, frameIndex: number) {
      if (disposed) return;
      frames.push(frame);
      current = null;
      events.onFrameDone?.(frame, frameIndex);
    },
    done(result: MeshAnimationResult) {
      if (disposed) return;
      runnerState = 'done';
      events.onDone?.(result);
    },
    error(error: Error) {
      if (disposed) return;
      runnerState = 'paused';
      events.onError?.(error);
    },
  };

  let control: { start(): void; pause(): void; stop(): void };
  if (kind === 'inline') {
    control = createAnimationLoop(target, baseConfig, ownSettings, weighting, progressInterval, handlers);
  } else {
    const worker = startMeshWorker(
      {
        type: 'init',
        target: { width: target.width, height: target.height, data: target.data },
        config: baseConfig,
        weighting,
        progressInterval,
        animation: ownSettings,
      },
      (message) => {
        if (message.type === 'frameStart') handlers.frameStart(message.frameIndex, message.seed);
        else if (message.type === 'progress') handlers.progress(message.result, message.generation, message.frameIndex);
        else if (message.type === 'frameDone') handlers.frameDone(message.result, message.frameIndex);
        else if (message.type === 'animationDone') handlers.done(message.result);
      },
      handlers.error,
    );
    control = {
      start: () => worker.send({ type: 'start' }),
      pause: () => worker.send({ type: 'pause' }),
      stop: () => worker.terminate(),
    };
  }

  return {
    get state() {
      return runnerState;
    },
    get frameIndex() {
      return frames.length;
    },
    start() {
      if (disposed) throw new Error('This animation runner has been disposed');
      if (runnerState === 'done') return;
      runnerState = 'running';
      control.start();
    },
    pause() {
      if (runnerState !== 'running') return;
      runnerState = 'paused';
      control.pause();
    },
    result() {
      return assembleMeshAnimation(target, baseConfig, ownSettings, frames);
    },
    currentFrame() {
      return current;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (runnerState === 'running') runnerState = 'paused';
      control.stop();
    },
  };
}
