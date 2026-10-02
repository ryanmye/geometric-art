import type {
  Bitmap,
  RunConfig,
  RunResult,
  Runner,
  RunnerEvents,
  RunnerOptions,
  RunnerState,
  ShapeRecord,
} from './types';
import { addShape, createModel, modelResult } from './model';
import { checkConfig } from './checkConfig';
import type { Executor } from '../worker/executor';
import { createExecutor } from '../worker/createExecutor';
import { weightingFromOptions, type Weighting } from './weights';

/**
 * If this many attempts in a row fail to find a shape that lowers the error,
 * the picture cannot be improved further (for example a plain image that
 * already matches its background), and the run finishes early.
 */
const MAX_FAILED_ATTEMPTS = 25;

/**
 * Create a runner that recreates `target` out of shapes.
 * `target` must already be at working size (longest side around 256 px).
 */
export function createRunner(
  target: Bitmap,
  config: RunConfig,
  events: RunnerEvents = {},
  options: RunnerOptions = {},
): Runner {
  checkConfig(target, config);
  const prefix = options.prefix ?? [];
  // Weights are turned into whole numbers once, here, and shared by everything.
  const weighting = weightingFromOptions(options, target.width, target.height);
  const executor = createExecutor(target, config, prefix, options, weighting?.weights ?? null);
  return createRunnerOnExecutor(target, config, events, prefix, weighting, executor, true);
}

/**
 * The runner itself, searching with an executor that is already set up for
 * this config, prefix and weighting. With `ownsExecutor` false, dispose() leaves the
 * executor running so the caller can reuse it (the animation runner does
 * this between frames).
 */
export function createRunnerOnExecutor(
  target: Bitmap,
  config: RunConfig,
  events: RunnerEvents,
  prefix: ShapeRecord[],
  weighting: Weighting | null,
  executor: Executor,
  ownsExecutor: boolean,
): Runner {
  checkConfig(target, config);
  const model = createModel(target, config, prefix, weighting?.weights ?? null, weighting?.importance);

  let state: RunnerState = 'idle';
  let loopIsRunning = false;
  let disposed = false;
  // Which attempt this is at the current shape; part of every climb's random seed.
  let retry = 0;

  async function runLoop(): Promise<void> {
    loopIsRunning = true;
    try {
      while (state === 'running' && !disposed) {
        if (model.records.length >= config.maxShapes || retry >= MAX_FAILED_ATTEMPTS || model.picture.total === 0) {
          state = 'done';
          events.onDone?.(modelResult(model));
          break;
        }
        if (executor.inline) await yieldToEventLoop();
        if (state !== 'running' || disposed) break;

        const shapeIndex = model.records.length;
        const outcome = await executor.search(shapeIndex, retry);
        if (disposed) break;

        // Accept the shape only if it lowers the error; otherwise try again
        // for the same shape with fresh random numbers.
        const record = addShape(model, outcome.shape);
        if (record) {
          retry = 0;
          executor.add(record);
          events.onShape?.(record, shapeIndex);
        } else {
          retry++;
        }
      }
    } catch (error) {
      if (!disposed) {
        state = 'paused';
        events.onError?.(error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      loopIsRunning = false;
    }
  }

  return {
    get state() {
      return state;
    },
    start() {
      if (disposed) throw new Error('This runner has been disposed');
      if (state === 'done') return;
      state = 'running';
      // After a quick pause/start the previous loop may still be finishing
      // its search; it will simply carry on.
      if (!loopIsRunning) void runLoop();
    },
    pause() {
      if (state === 'running') state = 'paused';
    },
    result(): RunResult {
      return modelResult(model);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      state = 'paused';
      if (ownsExecutor) executor.dispose();
    },
  };
}

/** Let timers, clicks and pause() calls run between shapes. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
