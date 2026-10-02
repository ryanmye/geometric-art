// A finished result kept with its photo: enough to show it again, with its
// stats and exports, without rerunning.

import type { AnimationResult, RunResult } from '../../engine/types';
import type { MeshAnimationResult, MeshResult } from '../../mesh';
import type { StatRow } from '../stats';
import type { Output, Style } from '../runs/activeRun';

export interface StoredResult {
  style: Style;
  output: Output;
  /** The settings it was made with (see batchPlan.ts), for the "skip finished photos" rule. */
  key: string;
  /** The shape list or mesh (or their animation). */
  snapshot: RunResult | AnimationResult | MeshResult | MeshAnimationResult;
  /** The stats panel as it was when the run finished. */
  stats: StatRow[];
  /** The quiet note shown with it, if any (e.g. fewer mesh points than asked). */
  note: string | null;
}

const STYLE_NAMES: Record<Style, string> = {
  shapes: 'Overlapping shapes',
  mesh: 'Triangle mesh',
  polygons: 'Polygon mosaic',
};
const OUTPUT_NAMES: Record<Output, string> = {
  single: 'single picture',
  animation: 'seed animation',
};

/** What a result is, in the words of the settings: "Polygon mosaic, seed animation". */
export function resultKind(kind: { style: Style; output: Output }): string {
  return `${STYLE_NAMES[kind.style]}, ${OUTPUT_NAMES[kind.output]}`;
}

/**
 * A plain note when a result being shown differs in style or output from
 * what the settings now say (otherwise the only sign would be the stats
 * wording), or null if they match.
 */
export function differentSettingsNote(result: { style: Style; output: Output }, chosen: { style: Style; output: Output }): string | null {
  if (result.style === chosen.style && result.output === chosen.output) return null;
  return `Shown: a result made as ${resultKind(result)}. The settings now say ${resultKind(chosen)}; Start makes a new one.`;
}
