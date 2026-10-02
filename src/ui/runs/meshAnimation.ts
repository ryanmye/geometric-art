// Styles "triangle mesh" and "polygon mosaic", output "seed animation": the
// mesh engine's animation runner (config.cells says triangles or polygons).
// The frame being built is redrawn whole on each progress report; the loop
// itself is handled by loopView.ts, exactly as for shapes.

import {
  createMeshAnimationRunner,
  drawMesh,
  meshToAnimatedSVG,
  type MeshAnimationResult,
  type MeshAnimationSettings,
  type MeshConfig,
  type MeshResult,
} from '../../mesh';
import type { LoopControls } from '../loopControls';
import { errorStat, timeStat } from '../stats';
import type { FrameSource } from '../exports/types';
import type { ActiveRun, RunContext, Style } from './activeRun';
import { createLoopView } from './loopView';
import { meshBaseName, meshOptions } from './meshPicture';

/** Finished mesh frames as a FrameSource for the player and the exports. */
export function meshFrames(frames: MeshResult[]): FrameSource {
  return {
    width: frames[0]?.width ?? 1,
    height: frames[0]?.height ?? 1,
    count: frames.length,
    draw: (ctx, index, scale) => drawMesh(ctx, frames[index], scale),
  };
}

/**
 * e.g. geometric-art-mesh-seed-1-points-300-frames-12-variation-0.3, or
 * geometric-art-polygons-… for polygons (frames = finished frames).
 */
export function meshAnimationName(animation: MeshAnimationResult): string {
  return `${meshBaseName(animation.config)}-frames-${animation.frames.length}-variation-${animation.variation}`;
}

export function createMeshAnimation(
  context: RunContext,
  style: Extract<Style, 'mesh' | 'polygons'>,
  config: MeshConfig,
  settings: MeshAnimationSettings,
  loop: LoopControls,
): ActiveRun {
  const { stage, photo, target } = context;
  const finished: MeshResult[] = [];
  const view = createLoopView(loop, target, settings.frames);
  let disposed = false;

  const runner = createMeshAnimationRunner(
    target,
    config,
    settings,
    {
      onFrameStart: () => context.onProgress(),
      onProgress: () => {
        if (disposed) return;
        if (!view.onStage) stage.redraw();
        context.onProgress();
      },
      onFrameDone: (frame) => {
        if (disposed) return;
        finished.push(frame);
        view.frameDone(meshFrames(finished));
        if (!view.onStage) stage.redraw();
        context.onProgress();
      },
      onDone: () => {
        if (disposed) return;
        view.allDone(stage.context);
        context.onDone();
      },
      onError: (error) => {
        if (!disposed) context.onError(error);
      },
    },
    meshOptions(context),
  );

  /** What the big picture shows: the frame being built, or the loop once done. */
  function drawStage(ctx: CanvasRenderingContext2D, scale: number): void {
    if (view.onStage) {
      view.redraw();
      return;
    }
    const building = runner.currentFrame() ?? finished[finished.length - 1];
    if (building) {
      drawMesh(ctx, building, scale);
    } else {
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }
  }

  return {
    style,
    output: 'animation',
    start() {
      view.show();
      stage.showDrawing(photo, target, drawStage);
      runner.start();
    },
    pause: () => runner.pause(),
    resume: () => runner.start(),
    dispose() {
      disposed = true;
      runner.dispose();
      view.dispose();
    },
    stats(elapsedMs) {
      // currentFrame() is null until the frame being built first reports;
      // once every frame is done, show the last one.
      const building = runner.currentFrame();
      const frame = building ?? (runner.state === 'done' ? finished[finished.length - 1] : null);
      const total = frame ? frame.config.generations : 0;
      // A frame with nothing to optimise (variation 0) is complete at once.
      const percent = !frame ? 0 : total > 0 ? Math.round((frame.generation / total) * 100) : 100;
      return [
        { key: 'frame', label: 'Frame', value: `${Math.min(runner.frameIndex + 1, settings.frames)} of ${settings.frames}` },
        { key: 'progress', label: 'Progress', value: `${percent}%`, title: 'Of the frame being built' },
        // Between frames, the error of the last finished one.
        errorStat((frame ?? finished[finished.length - 1])?.score ?? 0),
        timeStat(elapsedMs),
      ];
    },
    pictureExports: () => null,
    animationExports() {
      if (finished.length < 2) return null;
      const animation = runner.result();
      return {
        baseName: meshAnimationName(animation),
        frames: meshFrames(animation.frames),
        animatedSVG: (fps) => meshToAnimatedSVG(animation, fps),
        json: (fps) => JSON.stringify({ ...animation, fps }, null, 2),
      };
    },
    snapshot: () => runner.result(),
  };
}
