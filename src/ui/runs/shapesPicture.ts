// Style "overlapping shapes", output "single picture": one runner, each new
// shape drawn as it arrives.

import type { RunConfig, RunResult } from '../../engine/types';
import { createRunner } from '../../engine/runner';
import { drawResult } from '../../render/drawResult';
import { drawShape } from '../../render/drawShape';
import { toSVG } from '../../render/toSVG';
import { toJSON } from '../../render/toJSON';
import { errorStat, timeStat } from '../stats';
import type { PictureExports } from '../exports/types';
import type { ActiveRun, RunContext } from './activeRun';

/** What the single-picture export buttons save for a shapes result. */
export function shapesPictureExports(result: RunResult): PictureExports {
  return {
    baseName: `geometric-art-seed-${result.config.seed}`,
    width: result.width,
    height: result.height,
    draw: (ctx, scale) => drawResult(ctx, result, scale),
    svg: () => toSVG(result),
    json: () => toJSON(result),
  };
}

export function createShapesPicture(context: RunContext, config: RunConfig): ActiveRun {
  const { stage, photo, target } = context;
  let shapesFound = 0;
  let disposed = false;

  const runner = createRunner(
    target,
    config,
    {
      onShape: (record) => {
        if (disposed) return;
        shapesFound++;
        drawShape(stage.context, record, stage.scale);
        context.onProgress();
      },
      onDone: () => {
        if (!disposed) context.onDone();
      },
      onError: (error) => {
        if (!disposed) context.onError(error);
      },
    },
    context.runnerOptions,
  );

  return {
    style: 'shapes',
    output: 'single',
    start() {
      stage.showDrawing(photo, target, (ctx, scale) => drawResult(ctx, runner.result(), scale));
      runner.start();
    },
    pause: () => runner.pause(),
    resume: () => runner.start(),
    dispose() {
      disposed = true;
      runner.dispose();
    },
    stats(elapsedMs) {
      const result = runner.result();
      const seconds = elapsedMs / 1000;
      return [
        { key: 'shapes', label: 'Shapes', value: `${result.shapes.length} / ${config.maxShapes}` },
        errorStat(result.score),
        { key: 'speed', label: 'Speed', value: seconds > 0 && shapesFound > 0 ? `${(shapesFound / seconds).toFixed(1)} /s` : '–' },
        timeStat(elapsedMs),
      ];
    },
    pictureExports() {
      const result = runner.result();
      return result.shapes.length === 0 ? null : shapesPictureExports(result);
    },
    animationExports: () => null,
    snapshot: () => runner.result(),
  };
}
