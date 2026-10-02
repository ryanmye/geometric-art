// Styles "triangle mesh" and "polygon mosaic", output "single picture": the
// mesh engine's runner (config.cells says triangles or polygons). The whole
// mesh changes at once, so the picture is redrawn on every progress report
// (a few times a second) rather than shape by shape.

import {
  createMeshRunner,
  drawMesh,
  meshToSVG,
  type MeshConfig,
  type MeshResult,
  type MeshRunnerOptions,
} from '../../mesh';
import { errorStat, timeStat, type StatRow } from '../stats';
import type { ActiveRun, RunContext, Style } from './activeRun';

/**
 * Mesh runner options from the page's run options: the importance weights
 * (if any), and ?executor=inline (for checks) as the mesh engine's inline mode.
 */
export function meshOptions(context: RunContext): MeshRunnerOptions {
  const { executor, weights, importance } = context.runnerOptions;
  return { executor: executor === 'inline' ? 'inline' : undefined, weights, importance };
}

/** The cell count, labelled for the kind of cell: "Triangles" or "Polygons". */
export function cellStat(result: MeshResult): StatRow {
  return result.polygons
    ? { key: 'polygons', label: 'Polygons', value: String(result.polygons.length) }
    : { key: 'triangles', label: 'Triangles', value: String(result.triangles.length) };
}

/**
 * Start of the export file names: "geometric-art-mesh-…" for triangles (as
 * before polygons existed) and "geometric-art-polygons-…" for polygons.
 */
export function meshBaseName(config: MeshConfig): string {
  const kind = config.cells === 'polygons' ? 'polygons' : 'mesh';
  return `geometric-art-${kind}-seed-${config.seed}-points-${config.points}`;
}

export function createMeshPicture(
  context: RunContext,
  style: Extract<Style, 'mesh' | 'polygons'>,
  config: MeshConfig,
): ActiveRun {
  const { stage, photo, target } = context;
  let disposed = false;

  const runner = createMeshRunner(
    target,
    config,
    {
      onProgress: () => {
        if (disposed) return;
        stage.redraw();
        context.onProgress();
      },
      onDone: () => {
        if (disposed) return;
        stage.redraw();
        context.onDone();
      },
      onError: (error) => {
        if (!disposed) context.onError(error);
      },
    },
    meshOptions(context),
  );

  return {
    style,
    output: 'single',
    start() {
      stage.showDrawing(photo, target, (ctx, scale) => drawMesh(ctx, runner.result(), scale));
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
      const total = result.config.generations;
      const percent = total > 0 ? Math.round((result.generation / total) * 100) : 100;
      return [
        {
          key: 'progress',
          label: 'Progress',
          value: `${percent}%`,
          title: `${result.generation} of ${total} generations (one generation tries to move every point once)`,
        },
        cellStat(result),
        errorStat(result.score),
        timeStat(elapsedMs),
      ];
    },
    pictureExports() {
      const result: MeshResult = runner.result();
      return {
        baseName: meshBaseName(result.config),
        width: result.width,
        height: result.height,
        draw: (ctx, scale) => drawMesh(ctx, result, scale),
        svg: () => meshToSVG(result),
        json: () => JSON.stringify(result, null, 2),
      };
    },
    animationExports: () => null,
    snapshot: () => runner.result(),
  };
}
