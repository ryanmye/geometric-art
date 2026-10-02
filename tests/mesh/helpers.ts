import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import type { Bitmap } from '../../src/engine/types';
import { DEFAULT_MESH_CONFIG } from '../../src/mesh/config';
import { createMeshRunner } from '../../src/mesh/runner';
import type { MeshConfig, MeshResult } from '../../src/mesh/types';

export function loadFixture(): Bitmap {
  const path = fileURLToPath(new URL('../fixtures/mona-lisa-256.png', import.meta.url));
  const png = PNG.sync.read(readFileSync(path));
  return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) };
}

/** A quick config so whole runs take a fraction of a second. */
export function smallConfig(overrides: Partial<MeshConfig> = {}): MeshConfig {
  return { ...DEFAULT_MESH_CONFIG, seed: 7, points: 80, generations: 40, ...overrides };
}

/** Run inline to completion, collecting the progress reports. */
export function runToEnd(
  target: Bitmap,
  config: MeshConfig,
): Promise<{ result: MeshResult; progress: Array<{ result: MeshResult; generation: number }> }> {
  return new Promise((resolve, reject) => {
    const progress: Array<{ result: MeshResult; generation: number }> = [];
    const runner = createMeshRunner(
      target,
      config,
      {
        onProgress: (result, generation) => progress.push({ result, generation }),
        onDone: (result) => resolve({ result, progress }),
        onError: reject,
      },
      { executor: 'inline', progressInterval: 0 },
    );
    runner.start();
  });
}

/** Squared error of an RGBA picture against the target, over R, G, B. */
export function squaredError(picture: Bitmap, target: Bitmap): number {
  let total = 0;
  for (let i = 0; i < target.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const d = picture.data[i + c] - target.data[i + c];
      total += d * d;
    }
  }
  return total;
}
