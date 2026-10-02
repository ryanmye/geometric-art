// Builds an animated GIF from a list of same-size PNG frames, on the
// command line, using the encoder in src/export/gif.
//
//   npx tsx scripts/gif.ts <out.gif> <frame1.png> <frame2.png> ... [--delay 125] [--dither] [--loop 0] [--colors 256] [--local]
//
// Frames are read in the order given. See scripts/run.ts for how to make
// frames from this project's engine (vary --seed for each one).

import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { encodeGif } from '../src/export/gif/encodeGif';
import type { Bitmap } from '../src/engine/types';

function parseArgs(argv: string[]): { output: string; inputs: string[]; flags: Map<string, string> } {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const name = argv[i].slice(2);
      // Boolean flags (no value follows, or the next token is itself a flag/missing).
      if (name === 'dither' || name === 'local') {
        flags.set(name, 'true');
      } else {
        flags.set(name, argv[i + 1] ?? '');
        i++;
      }
    } else {
      positional.push(argv[i]);
    }
  }
  if (positional.length < 2) {
    console.error(
      'usage: npx tsx scripts/gif.ts <out.gif> <frame1.png> <frame2.png> ... ' +
        '[--delay 125] [--dither] [--loop 0] [--colors 256] [--local]',
    );
    process.exit(1);
  }
  return { output: positional[0], inputs: positional.slice(1), flags };
}

function readPng(path: string): Bitmap {
  const png = PNG.sync.read(readFileSync(path));
  // Composite over white, matching scripts/run.ts, so a PNG with an alpha
  // channel still ends up fully opaque (GIF output has no transparency).
  const data = new Uint8ClampedArray(png.width * png.height * 4);
  for (let i = 0; i < data.length; i += 4) {
    const a = png.data[i + 3] / 255;
    for (let c = 0; c < 3; c++) data[i + c] = Math.round(png.data[i + c] * a + 255 * (1 - a));
    data[i + 3] = 255;
  }
  return { width: png.width, height: png.height, data };
}

function main(): void {
  const { output, inputs, flags } = parseArgs(process.argv.slice(2));
  const frames = inputs.map(readPng);

  const started = performance.now();
  const bytes = encodeGif(frames, {
    delayMs: Number(flags.get('delay') ?? 125),
    loop: Number(flags.get('loop') ?? 0),
    maxColors: Number(flags.get('colors') ?? 256),
    dither: flags.has('dither'),
    palette: flags.has('local') ? 'local' : 'global',
  });
  const elapsed = performance.now() - started;

  writeFileSync(output, bytes);
  console.log(
    `${inputs.length} frame(s), ${frames[0].width}x${frames[0].height} -> ${output}\n` +
      `encoded in ${elapsed.toFixed(0)}ms, ${bytes.length} bytes (${(bytes.length / 1024).toFixed(1)} KB)`,
  );
}

main();
