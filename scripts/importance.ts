// Writes the importance map of a PNG as a greyscale picture, to look at.
//
//   npx tsx scripts/importance.ts <in.png> <out.png> [--strength 1] [--blur 0.03]

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { PNG } from 'pngjs';
import type { Bitmap } from '../src/engine/types';
import { computeImportance, importanceToBitmap, DEFAULT_IMPORTANCE_OPTIONS } from '../src/importance';

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
    console.error('usage: npx tsx scripts/importance.ts <in.png> <out.png> [--strength 1] [--blur 0.03]');
    process.exit(1);
  }
  return { input: positional[0], output: positional[1], flags };
}

function readPng(path: string): Bitmap {
  const png = PNG.sync.read(readFileSync(path));
  // Composite over white, same as scripts/run.ts, so the map is built from
  // what the engine actually sees.
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

function main(): void {
  const { input, output, flags } = parseArgs(process.argv.slice(2));
  const strength = Number(flags.get('strength') ?? DEFAULT_IMPORTANCE_OPTIONS.strength);
  const blurFraction = Number(flags.get('blur') ?? DEFAULT_IMPORTANCE_OPTIONS.blurFraction);

  const target = readPng(input);
  const weights = computeImportance(target, { strength, blurFraction });

  let min = Infinity;
  let max = -Infinity;
  for (const w of weights) {
    if (w < min) min = w;
    if (w > max) max = w;
  }

  writePng(output, importanceToBitmap(weights, target.width, target.height));
  console.log(`${input}: ${target.width}x${target.height}, strength=${strength}, blur=${blurFraction}`);
  console.log(`weight range: ${min.toFixed(4)} .. ${max.toFixed(4)} (ratio ${(max / min).toFixed(2)}x)`);
  console.log(`wrote ${output}`);
}

main();
