// Runs the optimiser in short slices, so the thread it runs on (the page
// inline, or the worker) can still handle pause requests in between, and
// reports the mesh at a steady pace.
//
// Slicing never changes the result: the generations run one after another
// with the same random generator whatever the slice boundaries are, so a
// paused and resumed run ends with exactly the same mesh.

import { runGeneration } from './optimizer';
import { meshResult } from './result';
import type { MeshState } from './state';
import type { MeshResult } from './types';

/** Work this long (ms) before letting other events run. */
const SLICE_MS = 25;

export interface LoopCallbacks {
  /** The current mesh, at most every progressInterval ms, and once when paused. */
  progress(result: MeshResult, generation: number): void;
  done(result: MeshResult): void;
  error(error: Error): void;
}

export interface Loop {
  /** Start, or resume after pause(). Does nothing once finished. */
  start(): void;
  /** Stop at the end of the current slice. */
  pause(): void;
  /** Stop for good. */
  stop(): void;
  readonly finished: boolean;
}

export function createLoop(state: MeshState, progressInterval: number, callbacks: LoopCallbacks): Loop {
  let wanted = false; // should the loop be running?
  let running = false; // is a loop currently active?
  let stopped = false;
  let finished = false;
  let lastProgress = now();

  async function run(): Promise<void> {
    running = true;
    try {
      while (wanted && !stopped) {
        if (state.generation >= state.config.generations) {
          finished = true;
          wanted = false;
          callbacks.done(meshResult(state));
          return;
        }
        const sliceStart = now();
        while (state.generation < state.config.generations && now() - sliceStart < SLICE_MS) {
          runGeneration(state);
        }
        if (state.generation < state.config.generations && now() - lastProgress >= progressInterval) {
          lastProgress = now();
          callbacks.progress(meshResult(state), state.generation);
        }
        await yieldToEvents();
      }
      if (!stopped && !finished) callbacks.progress(meshResult(state), state.generation);
    } catch (error) {
      wanted = false;
      callbacks.error(error instanceof Error ? error : new Error(String(error)));
    } finally {
      running = false;
    }
  }

  return {
    start() {
      if (stopped || finished) return;
      wanted = true;
      // After a quick pause/start the previous loop may still be finishing
      // its slice; it simply carries on.
      if (!running) void run();
    },
    pause() {
      wanted = false;
    },
    stop() {
      stopped = true;
      wanted = false;
    },
    get finished() {
      return finished;
    },
  };
}

function now(): number {
  return performance.now();
}

// Let queued events (such as a pause message) run, without the 4 ms minimum
// delay browsers add to repeated setTimeout(0) calls.
let channel: MessageChannel | null = null;
const waiting: Array<() => void> = [];

function yieldToEvents(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof setImmediate === 'function') {
      setImmediate(resolve); // Node
      return;
    }
    if (typeof MessageChannel === 'function') {
      if (!channel) {
        channel = new MessageChannel();
        channel.port1.onmessage = () => waiting.shift()?.();
      }
      waiting.push(resolve);
      channel.port2.postMessage(0);
      return;
    }
    setTimeout(resolve, 0);
  });
}
