// Per-triangle pixel totals kept between moves, 8 numbers per slot in one
// array: count, red, green, blue, then the weighted weight, red, green,
// blue (0 in an unweighted run). The optimiser uses them to estimate what
// removing a point would cost (optimizer.ts, removalCost).

import type { RunTotals } from './pixelSums';

export const SLOT_FIELDS = 8;

/** Copy the totals into entry `index` of `store`. */
export function storeTotals(store: Float64Array, index: number, totals: RunTotals): void {
  const i = SLOT_FIELDS * index;
  store[i] = totals.count;
  store[i + 1] = totals.red;
  store[i + 2] = totals.green;
  store[i + 3] = totals.blue;
  store[i + 4] = totals.weight;
  store[i + 5] = totals.wRed;
  store[i + 6] = totals.wGreen;
  store[i + 7] = totals.wBlue;
}

/** Copy entry `from` of `source` to entry `to` of `target`. */
export function copyTotals(source: Float64Array, from: number, target: Float64Array, to: number): void {
  for (let k = 0; k < SLOT_FIELDS; k++) target[SLOT_FIELDS * to + k] = source[SLOT_FIELDS * from + k];
}

/** Add entry `index` of `store` onto `sum` (only the fields stored here). */
export function addTotals(store: Float64Array, index: number, sum: RunTotals): void {
  const i = SLOT_FIELDS * index;
  sum.count += store[i];
  sum.red += store[i + 1];
  sum.green += store[i + 2];
  sum.blue += store[i + 3];
  sum.weight += store[i + 4];
  sum.wRed += store[i + 5];
  sum.wGreen += store[i + 6];
  sum.wBlue += store[i + 7];
}
