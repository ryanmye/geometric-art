// What the page needs from a run, whatever its style (overlapping shapes,
// triangle mesh or polygon mosaic) and output (single picture or seed
// animation). There is one small file per engine and output in this folder;
// createRun.ts picks the right one.

import type { AnimationResult, Bitmap, RunnerOptions, RunResult } from '../../engine/types';
import type { MeshAnimationResult, MeshResult } from '../../mesh';
import type { Stage } from '../stage';
import type { StatRow } from '../stats';
import type { AnimationExports, PictureExports } from '../exports/types';

/**
 * 'shapes': overlapping translucent shapes (the shape engine).
 * 'mesh': a triangle mesh, and 'polygons': a polygon mosaic; both come from
 * the mesh engine, with cells 'triangles' or 'polygons'.
 */
export type Style = 'shapes' | 'mesh' | 'polygons';

/** True for the styles made by the mesh engine. */
export function isMeshStyle(style: Style): style is 'mesh' | 'polygons' {
  return style === 'mesh' || style === 'polygons';
}
export type Output = 'single' | 'animation';

export interface RunContext {
  stage: Stage;
  photo: ImageBitmap;
  /** The photo at working size. */
  target: Bitmap;
  /** Executor choice and importance weights (passed to whichever engine runs). */
  runnerOptions: Pick<RunnerOptions, 'executor' | 'workerCount' | 'weights' | 'importance'>;
  /** Something changed that the stats or buttons should show. */
  onProgress(): void;
  /** The run finished. */
  onDone(): void;
  onError(error: Error): void;
}

export interface ActiveRun {
  readonly style: Style;
  readonly output: Output;
  /** Start computing (called once). */
  start(): void;
  pause(): void;
  resume(): void;
  /** Stop for good and release workers and images. */
  dispose(): void;
  /** Numbers for the stats panel. */
  stats(elapsedMs: number): StatRow[];
  /** What the single-picture export buttons save, or null if nothing yet (or not a single picture). */
  pictureExports(): PictureExports | null;
  /** What the animation export buttons save, or null if fewer than two frames are done (or not an animation). */
  animationExports(): AnimationExports | null;
  /** The run's result so far, for checking from scripts. */
  snapshot(): RunResult | AnimationResult | MeshResult | MeshAnimationResult;
}
