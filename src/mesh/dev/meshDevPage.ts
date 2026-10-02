// Script of mesh-dev.html: runs the mesh engine in a web worker on the
// fixture image and exposes what happened on window.meshDev, so a headless
// browser can check it. Not part of the production build.
//
// URL options: ?seed=1&points=300&quality=standard&generations=N
//   &cells=polygons Voronoi cells (starts from MESH_POLYGON_DEFAULTS)
//   &importance=S   weight pixels by computeImportance with strength S
//   &frames=N&variation=V&fps=F   run a seed animation instead of one mesh
//   &inline=1       also run inline on the page, to compare with the worker
//   &pause=1        pause and resume once during the run

import { computeImportance } from '../../importance';
import {
  createMeshAnimationRunner,
  createMeshRunner,
  DEFAULT_MESH_CONFIG,
  drawMesh,
  MESH_POLYGON_DEFAULTS,
  MESH_QUALITY_PRESETS,
  meshToAnimatedSVG,
  meshToSVG,
} from '../index';
import type { MeshAnimationResult, MeshConfig, MeshQuality, MeshResult, MeshRunnerOptions } from '../index';

interface DevReport {
  status: 'loading' | 'running' | 'done' | 'error';
  error?: string;
  config?: MeshConfig;
  progress: Array<{ generation: number; score: number; ms: number; frame: number }>;
  framesDone: number[];
  workerMs?: number;
  workerJSON?: string;
  inlineJSON?: string;
  /** With ?pause=1: generation (or frame) when paused, and whether it stayed there while paused. */
  pausedAt?: number;
  stayedPaused?: boolean;
  /** The target pixels as the browser decoded them (RGBA, row-major). */
  target?: { width: number; height: number; data: number[] };
}

const report: DevReport = { status: 'loading', progress: [], framesDone: [] };
(window as unknown as { meshDev: DevReport }).meshDev = report;
const log = (line: string) => {
  document.getElementById('log')!.textContent += line + '\n';
};

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const quality = (params.get('quality') ?? 'standard') as MeshQuality;
  const defaults = params.get('cells') === 'polygons' ? MESH_POLYGON_DEFAULTS : DEFAULT_MESH_CONFIG;
  const config: MeshConfig = {
    ...defaults,
    ...MESH_QUALITY_PRESETS[quality],
    seed: Number(params.get('seed') ?? defaults.seed),
    points: Number(params.get('points') ?? defaults.points),
  };
  if (params.has('generations')) config.generations = Number(params.get('generations'));
  report.config = config;

  // Decode the fixture the way the page would: draw it on a canvas, read the pixels.
  const image = new Image();
  image.src = '/tests/fixtures/mona-lisa-256.png';
  await image.decode();
  const targetCanvas = document.getElementById('target') as HTMLCanvasElement;
  targetCanvas.width = image.width;
  targetCanvas.height = image.height;
  const targetCtx = targetCanvas.getContext('2d')!;
  targetCtx.drawImage(image, 0, 0);
  const target = targetCtx.getImageData(0, 0, image.width, image.height);
  report.target = { width: target.width, height: target.height, data: Array.from(target.data) };

  const options: MeshRunnerOptions = {};
  if (params.has('importance')) {
    const strength = Number(params.get('importance'));
    options.weights = computeImportance(target, { strength });
    options.importance = { strength, painted: false };
  }

  const live = document.getElementById('live') as HTMLCanvasElement;
  live.width = target.width * 2;
  live.height = target.height * 2;
  const liveCtx = live.getContext('2d')!;
  const show = (mesh: MeshResult) => {
    liveCtx.clearRect(0, 0, live.width, live.height);
    drawMesh(liveCtx, mesh, 2);
  };
  const testPause = params.get('pause') === '1';
  const holder = document.getElementById('svg')!;
  report.status = 'running';
  const started = performance.now();

  if (params.has('frames')) {
    const settings = { frames: Number(params.get('frames')), variation: Number(params.get('variation') ?? 1) };
    const animation = await new Promise<MeshAnimationResult>((resolve, reject) => {
      const runner = createMeshAnimationRunner(
        target,
        config,
        settings,
        {
          onProgress: (mesh, generation, frame) => {
            report.progress.push({ generation, score: mesh.score, ms: Math.round(performance.now() - started), frame });
            show(mesh);
          },
          onFrameDone: (mesh, frame) => {
            report.framesDone.push(Math.round(performance.now() - started));
            show(mesh);
            if (testPause && frame === 0) {
              // Pause at the frame boundary (the worker may already be a slice
              // into the next frame), check nothing more happens, resume.
              runner.pause();
              setTimeout(() => {
                report.pausedAt = runner.frameIndex;
                const progressCount = report.progress.length;
                setTimeout(() => {
                  report.stayedPaused = runner.frameIndex === report.pausedAt && report.progress.length === progressCount;
                  runner.start();
                }, 400);
              }, 150);
            }
          },
          onDone: resolve,
          onError: reject,
        },
        { ...options, executor: 'worker' },
      );
      runner.start();
    });
    report.workerMs = Math.round(performance.now() - started);
    report.workerJSON = JSON.stringify(animation);
    // The looping SVG, shown at 2x in an <img> (as a page or export would).
    const svgText = meshToAnimatedSVG(animation, Number(params.get('fps') ?? 4));
    const img = document.createElement('img');
    img.src = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
    img.width = target.width * 2;
    img.height = target.height * 2;
    holder.appendChild(img);
    await img.decode();
    log(`worker animation: ${animation.frames.length} frames, ${report.progress.length} progress events, ${report.workerMs} ms, svg ${svgText.length} bytes`);
    if (params.get('inline') === '1') {
      const inline = await new Promise<MeshAnimationResult>((resolve, reject) => {
        createMeshAnimationRunner(target, config, settings, { onDone: resolve, onError: reject }, { ...options, executor: 'inline' }).start();
      });
      report.inlineJSON = JSON.stringify(inline);
    }
  } else {
    const result = await new Promise<MeshResult>((resolve, reject) => {
      let pauseTested = false;
      const runner = createMeshRunner(
        target,
        config,
        {
          onProgress: (mesh, generation) => {
            report.progress.push({ generation, score: mesh.score, ms: Math.round(performance.now() - started), frame: 0 });
            show(mesh);
            if (testPause && !pauseTested && report.progress.length === 2) {
              // Pause, check the worker really stops, then resume.
              pauseTested = true;
              runner.pause();
              setTimeout(() => {
                report.pausedAt = runner.result().generation;
                setTimeout(() => {
                  report.stayedPaused = runner.result().generation === report.pausedAt;
                  runner.start();
                }, 300);
              }, 200);
            }
          },
          onDone: resolve,
          onError: reject,
        },
        { ...options, executor: 'worker' },
      );
      runner.start();
    });
    report.workerMs = Math.round(performance.now() - started);
    report.workerJSON = JSON.stringify(result);
    show(result);
    // Final SVG shown at twice its size, for checking seams.
    holder.innerHTML = meshToSVG(result);
    const svg = holder.querySelector('svg')!;
    svg.setAttribute('width', String(target.width * 2));
    svg.setAttribute('height', String(target.height * 2));
    log(`worker: score ${result.score.toFixed(5)}, ${report.progress.length} progress events, ${report.workerMs} ms`);
    if (params.get('inline') === '1') {
      const inline = await new Promise<MeshResult>((resolve, reject) => {
        createMeshRunner(target, config, { onDone: resolve, onError: reject }, { ...options, executor: 'inline' }).start();
      });
      report.inlineJSON = JSON.stringify(inline);
    }
  }
  if (report.inlineJSON !== undefined) {
    log(`inline on the page: ${report.inlineJSON === report.workerJSON ? 'identical to worker' : 'DIFFERENT from worker'}`);
  }
  report.status = 'done';
}

main().catch((error) => {
  report.status = 'error';
  report.error = error instanceof Error ? error.message : String(error);
  log(`error: ${report.error}`);
});
