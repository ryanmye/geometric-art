// "Run all": which photos to run, in which order, and the rule for skipping
// photos that already have a result made with the same settings.

/** Everything that decides a photo's result, apart from the photo itself. */
export interface RunSettingsForKey {
  style: string;
  output: string;
  /** The style's own settings (shape config or mesh config). */
  config: unknown;
  /** Animation settings, or null for a single picture. */
  animation: unknown;
  workingSize: number;
  detail: number;
}

/**
 * A text that is the same exactly when the settings and the photo's painted
 * mask are the same. A result made with the same key would come out the same,
 * so "Run all" can skip it.
 */
export function resultKey(settings: RunSettingsForKey, mask: Uint8Array | null): string {
  return JSON.stringify({ ...settings, mask: mask ? maskFingerprint(mask) : null });
}

/**
 * A short fingerprint of a mask (32-bit FNV-1a hash of its bytes plus its
 * length): different paintings practically always differ.
 */
export function maskFingerprint(mask: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < mask.length; i++) {
    hash ^= mask[i];
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${mask.length}:${hash.toString(16)}`;
}

export interface BatchCandidate {
  id: number;
  /** Key of the photo's stored result, or null if it has none (or it failed). */
  resultKey: string | null;
  /** The key a run now would have (current settings and this photo's mask). */
  keyNow: string;
}

/**
 * The photos to run, in list order. Photos whose finished result was made
 * with the same key are skipped unless `redoFinished` is set.
 */
export function planBatch(candidates: BatchCandidate[], redoFinished: boolean): { run: number[]; skipped: number[] } {
  const run: number[] = [];
  const skipped: number[] = [];
  for (const candidate of candidates) {
    if (!redoFinished && candidate.resultKey !== null && candidate.resultKey === candidate.keyNow) {
      skipped.push(candidate.id);
    } else {
      run.push(candidate.id);
    }
  }
  return { run, skipped };
}

/** The note at the end of Run all, naming any photo that failed and why. */
export function batchSummary(made: number, skipped: number, failures: Array<{ name: string; reason: string }>): string {
  const count = (n: number) => `${n} photo${n === 1 ? '' : 's'}`;
  let text = `Run all finished: ${count(made)} made`;
  if (skipped > 0) text += `, ${skipped} skipped`;
  if (failures.length > 0) {
    text += `, ${failures.length} failed: ${failures.map((f) => `${f.name} (${f.reason})`).join('; ')}`;
  }
  return `${text}.`;
}
