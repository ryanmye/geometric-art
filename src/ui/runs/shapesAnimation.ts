// Style "overlapping shapes", output "seed animation". The frame being built
// is drawn shape by shape; the loop itself is handled by loopView.ts.

import type { AnimationResult, AnimationSettings, RunConfig, RunResult } from '../../engine/types';
import { createAnimationRunner } from '../../engine/animationRunner';
import { drawResult } from '../../render/drawResult';
import { drawShape } from '../../render/drawShape';
import { toAnimatedSVG } from '../../render/toAnimatedSVG';
import { animationToJSON } from '../../render/toJSON';
import type { LoopControls } from '../loopControls';
import { errorStat, timeStat } from '../stats';
import type { AnimationExports, FrameSource } from '../exports/types';
import type { ActiveRun, RunContext } from './activeRun';
import { createLoopView } from './loopView';

/** Finished shape frames as a FrameSource for the player and the exports. */
export function shapeFrames(frames: RunResult[]): FrameSource {
  return {
    width: frames[0]?.width ?? 1,
    height: frames[0]?.height ?? 1,
    count: frames.length,
    draw: (ctx, index, scale) => drawResult(ctx, frames[index], scale),
  };
}

/** e.g. geometric-art-seed-1-frames-12-shared-100 (frames = finished frames). */
export function shapesAnimationName(animation: AnimationResult): string {
  return `geometric-art-seed-${animation.config.seed}-frames-${animation.frames.length}-shared-${animation.shared}`;
}

/** What the animation export buttons save for a shapes animation. */
export function shapesAnimationExports(animation: AnimationResult): AnimationExports {
  return {
    baseName: shapesAnimationName(animation),
    frames: shapeFrames(animation.frames),
    animatedSVG: (fps) => toAnimatedSVG(animation, fps),
    json: (fps) => animationToJSON(animation, fps),
  };
}

export function createShapesAnimation(
  context: RunContext,
  config: RunConfig,
  settings: AnimationSettings,
  loop: LoopControls,
): ActiveRun {
  const { stage, photo, target } = context;
  const finished: RunResult[] = [];
  const view = createLoopView(loop, target, settings.frames);
  let shapesFound = 0;
  let disposed = false;

  const runner = createAnimationRunner(
    target,
    config,
    settings,
    {
      onFrameStart: () => {
        // Show the new frame's starting point (background and shared shapes).
        if (!disposed) stage.redraw();
        context.onProgress();
      },
      onShape: (record) => {
        if (disposed) return;
        shapesFound++;
        if (!view.onStage) drawShape(stage.context, record, stage.scale);
        context.onProgress();
      },
      onFrameDone: (frame) => {
        if (disposed) return;
        finished.push(frame);
        view.frameDone(shapeFrames(finished));
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
    context.runnerOptions,
  );

  /** What the big picture shows after a resize. */
  function drawStage(ctx: CanvasRenderingContext2D, scale: number): void {
    if (view.onStage) {
      view.redraw();
      return;
    }
    const building = runner.currentFrame() ?? finished[finished.length - 1];
    if (building) {
      drawResult(ctx, building, scale);
    } else {
      // Nothing yet: just the background colour.
      const [r, g, b] = runner.result().background;
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }
  }

  return {
    style: 'shapes',
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
      const frame = runner.currentFrame() ?? finished[finished.length - 1];
      const seconds = elapsedMs / 1000;
      return [
        { key: 'frame', label: 'Frame', value: `${Math.min(runner.frameIndex + 1, settings.frames)} of ${settings.frames}` },
        { key: 'shapes', label: 'Shapes', value: `${frame ? frame.shapes.length : 0} / ${config.maxShapes}` },
        errorStat(frame ? frame.score : 0),
        { key: 'speed', label: 'Speed', value: seconds > 0 && shapesFound > 0 ? `${(shapesFound / seconds).toFixed(1)} /s` : '–' },
        timeStat(elapsedMs),
      ];
    },
    pictureExports: () => null,
    animationExports: () => (finished.length < 2 ? null : shapesAnimationExports(runner.result())),
    snapshot: () => runner.result(),
  };
}
