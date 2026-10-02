import type { AnimationResult, RunResult } from '../engine/types';

/** The JSON export format is just the RunResult, pretty-printed. */
export function toJSON(result: RunResult): string {
  return JSON.stringify(result, null, 2);
}

/**
 * The animation JSON export: the AnimationResult (settings, shared prefix,
 * every frame as a full RunResult; see types.ts) plus the playback speed.
 * Read it back with parseAnimationJSON in src/engine/animationPlan.ts.
 */
export function animationToJSON(animation: AnimationResult, fps: number): string {
  return JSON.stringify({ ...animation, fps }, null, 2);
}
