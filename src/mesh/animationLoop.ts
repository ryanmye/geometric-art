// Runs a mesh seed animation: the frames one after another, each with the
// single-mesh loop (loop.ts). Used by the inline animation runner and,
// unchanged, inside the worker, so both give identical frames.

import type { Bitmap } from '../engine/types';
import {
  assembleMeshAnimation,
  copyOfFrame0,
  frameConfig,
  frameLayout,
} from './animationPlan';
import { createLoop, type Loop } from './loop';
import { createMeshState } from './state';
import type { MeshAnimationResult, MeshAnimationSettings, MeshConfig, MeshResult } from './types';
import type { MeshWeighting } from './weights';

export interface AnimationLoopCallbacks {
  frameStart(frameIndex: number, seed: number): void;
  progress(frame: MeshResult, generation: number, frameIndex: number): void;
  frameDone(frame: MeshResult, frameIndex: number): void;
  done(result: MeshAnimationResult): void;
  error(error: Error): void;
}

export interface AnimationLoop {
  /** Start, or resume after pause(). */
  start(): void;
  /** Stop soon (within the current frame, or before the next one starts). */
  pause(): void;
  /** Stop for good. */
  stop(): void;
  /** Finished frames so far. */
  readonly frames: MeshResult[];
  result(): MeshAnimationResult;
}

export function createAnimationLoop(
  target: Bitmap,
  config: MeshConfig,
  settings: MeshAnimationSettings,
  weighting: MeshWeighting | null,
  progressInterval: number,
  callbacks: AnimationLoopCallbacks,
): AnimationLoop {
  const frames: MeshResult[] = [];
  const size = { width: target.width, height: target.height };
  let current: Loop | null = null;
  let wanted = false;
  let stopped = false;
  let finished = false;

  function startNextFrame(): void {
    if (!wanted || stopped || current || finished) return;
    const index = frames.length;
    if (index >= settings.frames) {
      finished = true;
      callbacks.done(assembleMeshAnimation(size, config, settings, frames));
      return;
    }
    try {
      const frameSettings = frameConfig(config, index, settings.variation);
      callbacks.frameStart(index, frameSettings.seed);
      if (index > 0 && settings.variation <= 0) {
        finishFrame(copyOfFrame0(frames[0], frameSettings));
        return;
      }
      const startsFromFrame0 = index > 0 && settings.variation < 1;
      const layout = startsFromFrame0
        ? frameLayout(target, config, index, settings.variation, frames[0], weighting ? weighting.weights : null)
        : undefined;
      const state = createMeshState(target, frameSettings, weighting, layout);
      current = createLoop(state, progressInterval, {
        progress: (frame, generation) => callbacks.progress(frame, generation, index),
        done: (frame) => {
          current = null;
          finishFrame(frame);
        },
        error: (error) => {
          wanted = false;
          callbacks.error(error);
        },
      });
      current.start();
    } catch (error) {
      wanted = false;
      callbacks.error(error instanceof Error ? error : new Error(String(error)));
    }
  }

  function finishFrame(frame: MeshResult): void {
    frames.push(frame);
    callbacks.frameDone(frame, frames.length - 1);
    // Next frame on a fresh turn of the event loop, so pause() can get in
    // between and copied frames (variation 0) do not nest calls.
    setTimeout(startNextFrame, 0);
  }

  return {
    start() {
      if (stopped || finished) return;
      wanted = true;
      if (current) current.start();
      else startNextFrame();
    },
    pause() {
      wanted = false;
      current?.pause();
    },
    stop() {
      stopped = true;
      wanted = false;
      current?.stop();
    },
    get frames() {
      return frames;
    },
    result() {
      return assembleMeshAnimation(size, config, settings, frames);
    },
  };
}
