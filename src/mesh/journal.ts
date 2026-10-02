// An undo log for the triangulation.
//
// Trying a move changes the triangulation in place. Before each write the
// old value is recorded here as (which array, index, old value). To reject
// the move, undoJournal() walks the log backwards and puts every old value
// back, which restores the triangulation exactly, bit for bit.

import type { Triangulation } from './triangulation';

export interface Journal {
  /** False while building the first mesh, when nothing needs undoing. */
  recording: boolean;
  length: number;
  kinds: Uint8Array;
  indices: Int32Array;
  values: Int32Array;
}

export function createJournal(): Journal {
  const size = 1024;
  return {
    recording: false,
    length: 0,
    kinds: new Uint8Array(size),
    indices: new Int32Array(size),
    values: new Int32Array(size),
  };
}

/** Remember that array `kind` held `oldValue` at `index`. */
export function record(journal: Journal, kind: number, index: number, oldValue: number): void {
  if (!journal.recording) return;
  if (journal.length === journal.kinds.length) grow(journal);
  const i = journal.length++;
  journal.kinds[i] = kind;
  journal.indices[i] = index;
  journal.values[i] = oldValue;
}

/** Start recording a new move. */
export function beginJournal(journal: Journal): void {
  journal.recording = true;
  journal.length = 0;
}

/** Keep the changes (accept the move). */
export function commitJournal(journal: Journal): void {
  journal.length = 0;
}

/** Put back every recorded value, newest first (reject the move). */
export function undoJournal(journal: Journal, tri: Triangulation): void {
  // The codes match the J_* constants in triangulation.ts.
  for (let i = journal.length - 1; i >= 0; i--) {
    const index = journal.indices[i];
    const value = journal.values[i];
    switch (journal.kinds[i]) {
      case 0:
        tri.corners[index] = value;
        break;
      case 1:
        tri.twin[index] = value;
        break;
      case 2:
        tri.alive[index] = value;
        break;
      case 3:
        tri.pointEdge[index] = value;
        break;
      case 4:
        tri.freeSlots[index] = value;
        break;
      case 5:
        tri.freeCount = value;
        break;
    }
  }
  journal.length = 0;
}

function grow(journal: Journal): void {
  const size = journal.kinds.length * 2;
  const kinds = new Uint8Array(size);
  const indices = new Int32Array(size);
  const values = new Int32Array(size);
  kinds.set(journal.kinds);
  indices.set(journal.indices);
  values.set(journal.values);
  journal.kinds = kinds;
  journal.indices = indices;
  journal.values = values;
}
