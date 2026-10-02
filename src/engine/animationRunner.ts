// Runs a seed animation: one frame after another, each using the whole
// executor (worker pool). The executor is created once and reset between
// frames, so the workers and their copy of the target are reused.

import type {
  AnimationEvents,
  AnimationResult,
  AnimationRunner,
  AnimationSettings,
  Bitmap,
  RunConfig,
  RunnerOptions,
  RunnerState,
  RunResult,
  Runner,
} from './types';
import { averageColor } from './picture';
import { checkConfig } from './checkConfig';
import { assembleAnimation, checkAnimationSettings, frameConfig, framePrefix } from './animationPlan';
import { createRunnerOnExecutor } from './runner';
import { createExecutor } from '../worker/createExecutor';
import { weightingFromOptions } from './weights';

export function createAnimationRunner(
  target: Bitmap,
  config: RunConfig,
  settings: AnimationSettings,
  events: AnimationEvents = {},
  options: Pick<RunnerOptions, 'executor' | 'workerCount' | 'weights' | 'importance'> = {},
): AnimationRunner {
  checkConfig(target, config);
  checkAnimationSettings(settings, config);
  const picture = { width: target.width, height: target.height, background: averageColor(target) };

  // The same weights for every frame, converted once.
  const weighting = weightingFromOptions(options, target.width, target.height);
  // Set up for frame 0: the base config, no prefix.
  const executor = createExecutor(target, frameConfig(config, 0), [], options, weighting?.weights ?? null);

  let state: RunnerState = 'idle';
  let disposed = false;
  const frames: RunResult[] = [];
  /** The runner of the frame being built, if any. */
  let current: Runner | null = null;

  function startFrame(frameIndex: number): void {
    const frameSettings = frameConfig(config, frameIndex);
    const prefix = framePrefix(frameIndex, frames[0] ?? null, settings.shared);
    // Frame 0 uses the executor exactly as created; later frames reset it.
    if (frameIndex > 0) executor.reset(frameSettings, prefix);
    const runner = createRunnerOnExecutor(
      target,
      frameSettings,
      {
        onShape: (record, index) => events.onShape?.(record, index, frameIndex),
        onDone: (result) => finishFrame(runner, result),
        onError: (error) => {
          state = 'paused';
          events.onError?.(error);
        },
      },
      prefix,
      weighting,
      executor,
      false,
    );
    current = runner;
    events.onFrameStart?.(frameIndex, frameSettings.seed);
    runner.start();
  }

  function finishFrame(runner: Runner, result: RunResult): void {
    if (disposed || runner !== current) return;
    frames.push(result);
    current = null;
    runner.dispose(); // leaves the executor alone
    events.onFrameDone?.(result, frames.length - 1);
    if (frames.length >= settings.frames) {
      state = 'done';
      events.onDone?.(assembleAnimation(picture, config, settings, frames, weighting?.importance));
      return;
    }
    // Start the next frame on a fresh turn of the event loop, so a frame that
    // finishes at once (shared start = all shapes) does not nest calls.
    setTimeout(continueIfRunning, 0);
  }

  function continueIfRunning(): void {
    if (disposed || state !== 'running' || current || frames.length >= settings.frames) return;
    try {
      startFrame(frames.length);
    } catch (error) {
      state = 'paused';
      events.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  return {
    get state() {
      return state;
    },
    get frameIndex() {
      return frames.length;
    },
    start() {
      if (disposed) throw new Error('This animation runner has been disposed');
      if (state === 'done') return;
      state = 'running';
      if (current) current.start();
      else continueIfRunning();
    },
    pause() {
      if (state !== 'running') return;
      state = 'paused';
      current?.pause();
    },
    result(): AnimationResult {
      return assembleAnimation(picture, config, settings, frames, weighting?.importance);
    },
    currentFrame() {
      return current ? current.result() : null;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      state = 'paused';
      current?.dispose();
      current = null;
      executor.dispose();
    },
  };
}
