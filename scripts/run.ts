// Run the engine on a PNG from the command line, on this thread.
//
//   npx tsx scripts/run.ts <in.png> <out.png> [--shapes N] [--seed S]
//       [--types triangle,ellipse] [--quality draft|standard|fine] [--alpha A]
//       [--importance 0..1] [--json out.json]
//
// --importance focuses detail on edges and features, with weights from
// computeImportance, as the page's Detail slider does. Without the flag it
// uses the page's default (DEFAULT_IMPORTANCE_STRENGTH); 0 means unweighted.
//
// The input is used at its own size (resize it first; the page uses 256 px).
// Writes the picture at working size and prints the score and speed.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { PNG } from 'pngjs';
import { createRunner } from '../src/engine/runner';
import { DEFAULT_CONFIG, QUALITY_PRESETS, type Quality } from '../src/engine/config';
import { rasterizeResult } from '../src/engine/rasterizeResult';
import { computeImportance, importanceStrength } from '../src/importance';
import { SHAPE_TYPES, type Bitmap, type RunConfig, type RunResult, type ShapeType } from '../src/engine/types';

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
    console.error('usage: npx tsx scripts/run.ts <in.png> <out.png> [--shapes N] [--seed S] [--types a,b] [--quality q]');
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

function writePng(path: string, bitmap: Bitmap): void {
  const png = new PNG({ width: bitmap.width, height: bitmap.height });
  png.data = Buffer.from(bitmap.data);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, PNG.sync.write(png));
}

async function main(): Promise<void> {
  const { input, output, flags } = parseArgs(process.argv.slice(2));
  const quality = (flags.get('quality') ?? 'standard') as Quality;
  if (!(quality in QUALITY_PRESETS)) throw new Error(`Unknown quality "${quality}"`);
  const types = (flags.get('types') ?? DEFAULT_CONFIG.shapeTypes.join(',')).split(',') as ShapeType[];
  for (const type of types) {
    if (!SHAPE_TYPES.includes(type)) throw new Error(`Unknown shape type "${type}"; use ${SHAPE_TYPES.join(', ')}`);
  }
  const config: RunConfig = {
    ...DEFAULT_CONFIG,
    ...QUALITY_PRESETS[quality],
    shapeTypes: types,
    maxShapes: Number(flags.get('shapes') ?? DEFAULT_CONFIG.maxShapes),
    seed: Number(flags.get('seed') ?? DEFAULT_CONFIG.seed),
    alpha: Number(flags.get('alpha') ?? DEFAULT_CONFIG.alpha),
  };

  const target = readPng(input);
  // Read exactly as the page reads ?importance= (default when absent, 0 = off).
  const strength = importanceStrength(flags.get('importance'));
  // Strength 0 means no weights at all (the plain engine), as on the page.
  const weighting =
    strength > 0
      ? { weights: computeImportance(target, { strength }), importance: { strength, painted: false } }
      : {};
  const started = performance.now();
  const result = await new Promise<RunResult>((resolve, reject) => {
    const runner = createRunner(target, config, { onDone: resolve, onError: reject }, { executor: 'inline', ...weighting });
    runner.start();
  });
  const elapsed = performance.now() - started;

  writePng(output, rasterizeResult(result));
  const jsonPath = flags.get('json');
  if (jsonPath) writeFileSync(jsonPath, JSON.stringify(result, null, 2));

  const perShape = result.shapes.length > 0 ? elapsed / result.shapes.length : 0;
  console.log(
    `${input} ${target.width}x${target.height}  types=${types.join(',')}  quality=${quality}  seed=${config.seed}` +
      `  importance=${strength}\n` +
      `shapes=${result.shapes.length}  score=${result.score.toFixed(5)}  ` +
      (result.weightedScore !== undefined ? `weighted=${result.weightedScore.toFixed(5)}  ` : '') +
      `time=${(elapsed / 1000).toFixed(1)}s  ms/shape=${perShape.toFixed(1)}  -> ${output}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
