// Runs the searches in a pool of web workers.
//
// Every worker gets its own copy of the target (and of the per-pixel weights,
// if any) and builds its own copy of the
// current picture; after each accepted shape the page tells every worker to
// paint it. Messages to a worker are handled in order, so a worker always
// paints the latest shape before it starts the next search. No shared memory
// is needed.
//
// Climbs are handed out one at a time: each worker gets one, and whenever a
// worker finishes it gets the next, so a slow climb does not hold up a whole
// batch. Which worker runs which climb does not affect the outcome, because a
// climb's random numbers depend only on (seed, shape, attempt, climb index).

import type { Bitmap, RunConfig, ShapeRecord } from '../engine/types';
import { pickBest, type SearchOutcome } from '../engine/searcher';
import type { Executor } from './executor';
import type { FromWorker, ToWorker } from './messages';

interface PendingSearch {
  id: number;
  shapeIndex: number;
  retry: number;
  /** The next climb index to hand out. */
  nextClimb: number;
  /** Climbs handed out whose results have not come back yet. */
  outstanding: number;
  outcomes: SearchOutcome[];
  resolve(outcome: SearchOutcome): void;
  reject(error: Error): void;
}

export function createWorkerExecutor(
  target: Bitmap,
  config: RunConfig,
  prefix: ShapeRecord[],
  workerCount: number,
  weights: Uint16Array | null = null,
): Executor {
  // More workers than climbs would sit idle.
  const count = Math.max(1, Math.min(workerCount, config.climbs));
  const workers: Worker[] = [];
  let pending: PendingSearch | null = null;
  let nextId = 1;
  let currentConfig = config;
  let failure: Error | null = null;

  function send(worker: Worker, message: ToWorker): void {
    worker.postMessage(message);
  }

  function fail(error: Error): void {
    failure = failure ?? error;
    if (pending) {
      const { reject } = pending;
      pending = null;
      reject(error);
    }
  }

  /** Give this worker the next climb of the current search, if any are left. */
  function handOutClimb(worker: Worker): void {
    if (!pending || pending.nextClimb >= currentConfig.climbs) return;
    const climb = pending.nextClimb++;
    pending.outstanding++;
    send(worker, {
      type: 'search',
      id: pending.id,
      shapeIndex: pending.shapeIndex,
      retry: pending.retry,
      climbs: [climb],
    });
  }

  for (let i = 0; i < count; i++) {
    const worker = new Worker(new URL('./search.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<FromWorker>) => {
      const message = event.data;
      if (message.type === 'error') {
        fail(new Error(`Search worker failed: ${message.message}`));
        return;
      }
      if (!pending || message.id !== pending.id) return;
      pending.outcomes.push(message.outcome);
      pending.outstanding--;
      handOutClimb(worker);
      if (pending.outstanding === 0) {
        const done = pending;
        pending = null;
        done.resolve(pickBest(done.outcomes));
      }
    };
    worker.onerror = (event) => {
      event.preventDefault();
      fail(new Error(`Search worker failed to run: ${event.message || 'unknown error'}`));
    };
    worker.onmessageerror = () => fail(new Error('Search worker sent a message that could not be read'));
    // postMessage copies the pixels, so each worker has its own target.
    const plainTarget: Bitmap = { width: target.width, height: target.height, data: target.data };
    send(worker, { type: 'init', target: plainTarget, config, prefix, weights });
    workers.push(worker);
  }

  return {
    inline: false,
    search(shapeIndex, retry) {
      return new Promise<SearchOutcome>((resolve, reject) => {
        if (failure) return reject(failure);
        if (pending) return reject(new Error('A search is already running'));
        pending = { id: nextId++, shapeIndex, retry, nextClimb: 0, outstanding: 0, outcomes: [], resolve, reject };
        for (const worker of workers) handOutClimb(worker);
      });
    },
    add(record) {
      for (const worker of workers) send(worker, { type: 'add', record });
    },
    reset(newConfig, newPrefix) {
      if (pending) throw new Error('Cannot reset while a search is running');
      currentConfig = newConfig;
      for (const worker of workers) send(worker, { type: 'reset', config: newConfig, prefix: newPrefix });
    },
    dispose() {
      for (const worker of workers) worker.terminate();
      workers.length = 0;
      if (pending) fail(new Error('Runner was disposed'));
    },
  };
}
