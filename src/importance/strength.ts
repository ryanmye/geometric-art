// The "Detail focus" strength: one default and one rule for reading it, shared
// by the page (slider and ?importance=), scripts/run.ts and scripts/mesh.ts,
// so a script run with no --importance flag matches a page run with
// untouched settings.

/** Default strength of "focus detail on edges and features" (0 = off, 1 = full). */
export const DEFAULT_IMPORTANCE_STRENGTH = 0.75;

/**
 * The strength actually used for a value someone gave (a URL parameter, a
 * command-line flag or the slider): missing means the default; otherwise it
 * is clamped to 0–1 and rounded to whole percent, which is what the page's
 * slider can hold. 0 means no weights at all (the plain, unweighted engine).
 * Throws for something that is not a number.
 */
export function importanceStrength(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === '') return DEFAULT_IMPORTANCE_STRENGTH;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Importance strength must be a number from 0 to 1, got "${value}"`);
  const clamped = Math.min(1, Math.max(0, number));
  return Math.round(clamped * 100) / 100;
}
