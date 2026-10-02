// Messages between the page and a search worker.

import type { Bitmap, RunConfig, ShapeRecord } from '../engine/types';
import type { SearchOutcome } from '../engine/searcher';

export type ToWorker =
  | { type: 'init'; target: Bitmap; config: RunConfig; prefix: ShapeRecord[]; weights: Uint16Array | null }
  | { type: 'reset'; config: RunConfig; prefix: ShapeRecord[] }
  | { type: 'add'; record: ShapeRecord }
  | { type: 'search'; id: number; shapeIndex: number; retry: number; climbs: number[] };

export type FromWorker =
  | { type: 'result'; id: number; outcome: SearchOutcome }
  | { type: 'error'; message: string };
