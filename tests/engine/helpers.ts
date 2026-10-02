import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { createRunner } from '../../src/engine/runner';
import type { Bitmap, RunConfig, RunResult, RunnerOptions, ShapeRecord } from '../../src/engine/types';

export function loadFixture(): Bitmap {
  const path = fileURLToPath(new URL('../fixtures/mona-lisa-256.png', import.meta.url));
  const png = PNG.sync.read(readFileSync(path));
  return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) };
}

/** A quick config so whole runs finish in well under a second. */
export function smallConfig(overrides: Partial<RunConfig> = {}): RunConfig {
  return {
    seed: 7,
    shapeTypes: ['triangle', 'rectangle', 'rotatedRectangle', 'ellipse', 'rotatedEllipse'],
    alpha: 128,
    maxShapes: 12,
    climbs: 5,
    candidates: 20,
    maxAge: 20,
    errorBias: 0.8,
    ...overrides,
  };
}

/** Run inline to completion; also collect what onShape reported. */
export function runToEnd(
  target: Bitmap,
  config: RunConfig,
  options: RunnerOptions = {},
): Promise<{ result: RunResult; reported: Array<{ record: ShapeRecord; index: number }> }> {
  return new Promise((resolve, reject) => {
    const reported: Array<{ record: ShapeRecord; index: number }> = [];
    const runner = createRunner(
      target,
      config,
      {
        onShape: (record, index) => reported.push({ record, index }),
        onDone: (result) => resolve({ result, reported }),
        onError: reject,
      },
      { executor: 'inline', ...options },
    );
    runner.start();
  });
}
