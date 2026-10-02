// A search worker. A thin wrapper: it keeps one Searcher and calls the same
// functions the inline executor calls.

import { addRecord, createSearcher, runClimbs, type Searcher } from '../engine/searcher';
import type { Bitmap } from '../engine/types';
import type { FromWorker, ToWorker } from './messages';

let searcher: Searcher | null = null;
// Kept so 'reset' can start a new run without the page sending the pixels again.
let target: Bitmap | null = null;
let weights: Uint16Array | null = null;

function reply(message: FromWorker): void {
  self.postMessage(message);
}

self.onmessage = (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  try {
    if (message.type === 'init') {
      target = message.target;
      weights = message.weights;
      searcher = createSearcher(message.target, message.config, message.prefix, weights);
      return;
    }
    if (!searcher || !target) throw new Error('Worker used before init');
    if (message.type === 'reset') {
      searcher = createSearcher(target, message.config, message.prefix, weights);
      return;
    }
    if (message.type === 'add') {
      addRecord(searcher, message.record);
    } else if (message.type === 'search') {
      const outcome = runClimbs(searcher, message.shapeIndex, message.retry, message.climbs);
      reply({ type: 'result', id: message.id, outcome });
    }
  } catch (error) {
    reply({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
