import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { computeImportance } from '../../src/importance';
import { DEFAULT_MESH_CONFIG } from '../../src/mesh/config';
import { createMeshRunner } from '../../src/mesh/runner';
import type { MeshConfig, MeshResult, MeshRunnerOptions } from '../../src/mesh/types';
import { meshWeights } from '../../src/mesh/weights';
import { LONG_TEST_TIMEOUT } from '../timing';
import { loadFixture, smallConfig } from './helpers';

const target = loadFixture();
const { width, height } = target;

function run(config: MeshConfig, options: MeshRunnerOptions = {}): Promise<MeshResult> {
  return new Promise((resolve, reject) => {
    createMeshRunner(target, config, { onDone: resolve, onError: reject }, { executor: 'inline', ...options }).start();
  });
}

describe('weights', () => {
  it('without weights the output is byte-identical to before weights existed', { timeout: LONG_TEST_TIMEOUT }, async () => {
    // SHA-256 of the JSON export for the default config (seed 1, 300 points,
    // standard), recorded before the weights option was added.
    const result = await run(DEFAULT_MESH_CONFIG);
    const hash = createHash('sha256').update(JSON.stringify(result)).digest('hex');
    expect(hash).toBe('7b68d9fe946bf9e849e4bd42f49f8d1e3c1bb83b2878e13b26c65c8d7023320a');
  });

  it('all-ones weights give exactly the unweighted mesh', async () => {
    const config = smallConfig({ points: 150, generations: 60 });
    const plain = await run(config);
    const ones = await run(config, { weights: new Float32Array(width * height).fill(1), importance: { strength: 0 } });
    expect(ones.points).toEqual(plain.points);
    expect(ones.triangles).toEqual(plain.triangles);
    expect(ones.score).toBe(plain.score);
    expect(ones.weightedScore).toBe(plain.score);
    expect(ones.importance).toEqual({ strength: 0 });
  });

  it('importance weights change the mesh, and are reproducible', async () => {
    const config = smallConfig({ points: 150, generations: 60 });
    const weights = computeImportance(target, { strength: 1 });
    const a = await run(config, { weights, importance: { strength: 1 } });
    const b = await run(config, { weights, importance: { strength: 1 } });
    const plain = await run(config);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.points).not.toEqual(plain.points);
    expect(a.weightedScore).toBeGreaterThan(0);
  });

  it('converts to whole numbers with mean 256 and floor 1, and rejects bad input', () => {
    const w = meshWeights([0, 1, 2, 1], 2, 2);
    expect(Array.from(w)).toEqual([1, 256, 512, 256]);
    expect(() => meshWeights([1, 2, 3], 2, 2)).toThrow(/one value per pixel/);
    expect(() => meshWeights([1, -1, 1, 1], 2, 2)).toThrow(/0 or more/);
    expect(() => meshWeights([0, 0, 0, 0], 2, 2)).toThrow(/all zero/);
    expect(() => createMeshRunner(target, DEFAULT_MESH_CONFIG, {}, { executor: 'inline', weights: [1, 2] })).toThrow(/per pixel/);
  });
});
