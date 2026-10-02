// Run the mesh engine on a PNG from the command line, on this thread.
//
//   npx tsx scripts/mesh.ts <in.png> <out.png> [--points N] [--seed S]
//       [--quality draft|standard|fine] [--generations G] [--svg out.svg]
//       [--json out.json] [--scale K] [--importance 0..1]
//       [--cells triangles|polygons]
//       [--frames N --variation 0..1 [--fps F]]
//
// The input is used at its own size (resize it first; the page uses 256 px).
// Writes the mesh as a PNG at working size times --scale (default 1) and
// prints the score and time.
//
// --importance S weights each pixel's error by computeImportance with
// strength S (edges and features count more), recorded as the page records
// an unpainted run: { strength: S, painted: false }; 0 means unweighted, as
// on the page. Without the flag it uses the page's default strength
// (DEFAULT_IMPORTANCE_STRENGTH), read exactly as the page reads ?importance=.
// --cells polygons draws Voronoi cells instead of triangles; it uses
// MESH_POLYGON_DEFAULTS (unless --points is given).
// --frames N makes a seed animation: frames are written as out-00.png,
// out-01.png, ...; --svg writes the looping animated SVG (at --fps, default
// 8) and --json the animation JSON.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { PNG } from 'pngjs';
import { createMeshRunner } from '../src/mesh/runner';
import { createMeshAnimationRunner } from '../src/mesh/animationRunner';
import { meshToAnimatedSVG } from '../src/mesh/toAnimatedSVG';
import { computeImportance, importanceStrength } from '../src/importance';
import { DEFAULT_MESH_CONFIG, MESH_POLYGON_DEFAULTS, MESH_QUALITY_PRESETS, type MeshQuality } from '../src/mesh/config';
import { rasterizeMesh } from '../src/mesh/rasterizeMesh';
import { meshToSVG } from '../src/mesh/toSVG';
import type { Bitmap } from '../src/engine/types';
import type { MeshAnimationResult, MeshConfig, MeshResult, MeshRunnerOptions } from '../src/mesh/types';

function parseArgs(argv: string[]): { input: string; output: string; flags: Map<string, string> } {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      flags.set(argv[i].slice(2), argv[i + 1] ?? '');
      i++;
    } else {
      positional.push(argv[i]);
    }
  }
  if (positional.length !== 2) {
    console.error(
      'usage: npx tsx scripts/mesh.ts <in.png> <out.png> [--points N] [--seed S] [--quality q] [--svg f] [--json f]',
    );
    process.exit(1);
  }
  return { input: positional[0], output: positional[1], flags };
}

function readPng(path: string): Bitmap {
  const png = PNG.sync.read(readFileSync(path));
  // Composite over white, as the page does, so transparency is handled the same way.
  const data = new Uint8ClampedArray(png.width * png.height * 4);
  for (let i = 0; i < data.length; i += 4) {
    const a = png.data[i + 3] / 255;
    for (let c = 0; c < 3; c++) data[i + c] = Math.round(png.data[i + c] * a + 255 * (1 - a));
    data[i + 3] = 255;
  }
  return { width: png.width, height: png.height, data };
}

/** Write `bitmap` enlarged `scale` times (each pixel repeated). */
function writePng(path: string, bitmap: Bitmap, scale: number): void {
  const width = bitmap.width * scale;
  const height = bitmap.height * scale;
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = 4 * (Math.floor(y / scale) * bitmap.width + Math.floor(x / scale));
      const to = 4 * (y * width + x);
      for (let c = 0; c < 4; c++) png.data[to + c] = bitmap.data[from + c];
    }
  }
  write(path, PNG.sync.write(png));
}

function write(path: string, content: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

async function main(): Promise<void> {
  const { input, output, flags } = parseArgs(process.argv.slice(2));
  const quality = (flags.get('quality') ?? 'standard') as MeshQuality;
  if (!(quality in MESH_QUALITY_PRESETS)) throw new Error(`Unknown quality "${quality}"`);
  const cells = flags.get('cells') ?? 'triangles';
  if (cells !== 'triangles' && cells !== 'polygons') throw new Error(`Unknown cells "${cells}"`);
  // Triangle configs have no `cells` field at all, exactly as before polygons existed.
  const defaults = cells === 'polygons' ? MESH_POLYGON_DEFAULTS : DEFAULT_MESH_CONFIG;
  const config: MeshConfig = {
    ...defaults,
    ...MESH_QUALITY_PRESETS[quality],
    points: Number(flags.get('points') ?? defaults.points),
    seed: Number(flags.get('seed') ?? defaults.seed),
  };
  if (flags.has('generations')) config.generations = Number(flags.get('generations'));

  // A target given as raw JSON pixels ({width, height, data: number[]}) is
  // used as is (the browser check feeds the page's own pixels this way).
  const target: Bitmap = input.endsWith('.json') ? readPixelsJson(input) : readPng(input);
  const options: MeshRunnerOptions = { executor: 'inline' };
  const strength = importanceStrength(flags.get('importance'));
  if (strength > 0) {
    options.weights = computeImportance(target, { strength });
    options.importance = { strength, painted: false };
  }
  const scale = Number(flags.get('scale') ?? 1);
  const label =
    `${input} ${target.width}x${target.height}  quality=${quality}  seed=${config.seed}  ` +
    `points=${config.points}  generations=${config.generations}  cells=${cells}` +
    `  importance=${strength}`;

  if (flags.has('frames')) {
    const settings = { frames: Number(flags.get('frames')), variation: Number(flags.get('variation') ?? 1) };
    const started = performance.now();
    const animation = await new Promise<MeshAnimationResult>((resolve, reject) => {
      const runner = createMeshAnimationRunner(target, config, settings, { onDone: resolve, onError: reject }, options);
      runner.start();
    });
    const elapsed = performance.now() - started;
    const base = output.replace(/\.png$/, '');
    animation.frames.forEach((frame, i) => writePng(`${base}-${String(i).padStart(2, '0')}.png`, rasterizeMesh(frame), scale));
    const svgPath = flags.get('svg');
    if (svgPath) write(svgPath, meshToAnimatedSVG(animation, Number(flags.get('fps') ?? 8)));
    const jsonPath = flags.get('json');
    if (jsonPath) write(jsonPath, JSON.stringify(animation));
    console.log(
      `${label}  frames=${settings.frames}  variation=${settings.variation}\n` +
        `scores=${animation.frames.map((f) => f.score.toFixed(4)).join(',')}  ` +
        `time=${(elapsed / 1000).toFixed(2)}s  -> ${base}-NN.png`,
    );
    return;
  }

  const started = performance.now();
  const result = await new Promise<MeshResult>((resolve, reject) => {
    const runner = createMeshRunner(target, config, { onDone: resolve, onError: reject }, options);
    runner.start();
  });
  const elapsed = performance.now() - started;

  writePng(output, rasterizeMesh(result), scale);
  const svgPath = flags.get('svg');
  if (svgPath) write(svgPath, meshToSVG(result));
  const jsonPath = flags.get('json');
  if (jsonPath) write(jsonPath, JSON.stringify(result));

  console.log(
    `${label}\n` +
      `triangles=${result.triangles.length}  score=${result.score.toFixed(5)}  ` +
      (result.weightedScore !== undefined ? `weightedScore=${result.weightedScore.toFixed(5)}  ` : '') +
      `time=${(elapsed / 1000).toFixed(2)}s  -> ${output}`,
  );
}

function readPixelsJson(path: string): Bitmap {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as { width: number; height: number; data: number[] };
  return { width: parsed.width, height: parsed.height, data: Uint8ClampedArray.from(parsed.data) };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
