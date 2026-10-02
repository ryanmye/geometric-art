import { describe, expect, it } from 'vitest';
import { buildTriangulation } from '../../src/mesh/buildTriangulation';
import { checkMeshConfig, DEFAULT_MESH_CONFIG, MESH_QUALITY_PRESETS } from '../../src/mesh/config';
import { runGeneration } from '../../src/mesh/optimizer';
import { meshResult } from '../../src/mesh/result';
import { createMeshRunner } from '../../src/mesh/runner';
import { createMeshState } from '../../src/mesh/state';
import { meshToSVG } from '../../src/mesh/toSVG';
import type { MeshResult } from '../../src/mesh/types';
import { checkTriangulation } from './checkTriangulation';
import { loadFixture, runToEnd, smallConfig } from './helpers';

const target = loadFixture();
const { width, height } = target;

describe('constraints after optimisation', () => {
  it('corners stay put, border points stay on the border, the mesh covers the image', async () => {
    const config = smallConfig({ points: 150, generations: 80, borderDensity: 1 });
    const { result } = await runToEnd(target, config);
    const { points } = result;
    expect(points.length).toBe(150);
    expect(points.slice(0, 4)).toEqual([[0, 0], [width, 0], [width, height], [0, height]]);

    const start = createMeshState(target, config);
    const keys = new Set<string>();
    for (let p = 0; p < points.length; p++) {
      const [x, y] = points[p];
      expect(Number.isInteger(x) && Number.isInteger(y)).toBe(true);
      expect(x >= 0 && x <= width && y >= 0 && y <= height).toBe(true);
      const onBorder = x === 0 || x === width || y === 0 || y === height;
      // Border points stay on the border; interior points stay strictly inside.
      if (p >= 4) expect(onBorder).toBe(p < start.interiorStart);
      keys.add(`${x},${y}`);
    }
    expect(keys.size).toBe(points.length); // no two points in one place
    expect(start.interiorStart - 4).toBeGreaterThan(10);

    // Every point is used, and the triangles tile the image exactly once (Delaunay).
    const used = new Set(result.triangles.flatMap((t) => t.vertices));
    expect(used.size).toBe(points.length);
    const xs = Int32Array.from(points, (p) => p[0]);
    const ys = Int32Array.from(points, (p) => p[1]);
    const rebuilt = buildTriangulation(xs, ys);
    expect(checkTriangulation(rebuilt, width, height)).toEqual([]);
    // Triangle count of a triangulation of n points with b on the hull.
    const hull = points.filter(([x, y]) => x === 0 || x === width || y === 0 || y === height).length;
    expect(result.triangles.length).toBe(2 * points.length - hull - 2);
  });

  it('the state keeps a valid triangulation throughout', () => {
    const state = createMeshState(target, smallConfig({ points: 120, generations: 30 }));
    for (let g = 0; g < 30; g++) {
      runGeneration(state);
      if (g % 10 === 9) expect(checkTriangulation(state.tri, width, height)).toEqual([]);
    }
  });
});

describe('reproducibility', () => {
  it('same target, config and seed give the identical mesh', async () => {
    const a = await runToEnd(target, smallConfig());
    const b = await runToEnd(target, smallConfig());
    expect(JSON.stringify(a.result)).toBe(JSON.stringify(b.result));
  });

  it('different seeds give different meshes of similar quality', async () => {
    const a = await runToEnd(target, smallConfig({ seed: 1 }));
    const b = await runToEnd(target, smallConfig({ seed: 2 }));
    expect(JSON.stringify(a.result.points)).not.toBe(JSON.stringify(b.result.points));
    expect(Math.abs(a.result.score - b.result.score)).toBeLessThan(0.01);
  });

  it('the runner gives the same mesh as calling the optimiser directly', async () => {
    const config = smallConfig();
    const { result } = await runToEnd(target, config);
    const state = createMeshState(target, config);
    for (let g = 0; g < config.generations; g++) runGeneration(state);
    expect(meshResult(state)).toEqual(result);
  });

  it('a known config and seed give a known score (same in every JavaScript engine)', async () => {
    // Pinned value: changes only if the algorithm changes. The browser check
    // compares whole meshes between Node and Chrome.
    const { result } = await runToEnd(target, smallConfig());
    expect(result.score).toBe(0.05332048844974659);
    expect(result.points.slice(4, 8)).toEqual([[0, 6], [92, 0], [171, 98], [171, 135]]);
  });
});

describe('runner', () => {
  it('improves over time and reports progress', async () => {
    const config = smallConfig({ generations: 60 });
    const initial = meshResult(createMeshState(target, config));
    const { result, progress } = await runToEnd(target, config);
    expect(result.score).toBeLessThan(initial.score * 0.85);
    expect(result.generation).toBe(60);
    expect(progress.length).toBeGreaterThan(0);
    for (const report of progress) expect(report.result.generation).toBe(report.generation);
  });

  it('pause stops it, and resuming finishes with the same mesh as an uninterrupted run', async () => {
    const config = smallConfig({ points: 200, generations: 300 });
    const uninterrupted = await runToEnd(target, config);

    let done: MeshResult | null = null;
    let doneCount = 0;
    const runner = createMeshRunner(
      target,
      config,
      { onDone: (result) => { done = result; doneCount++; } },
      { executor: 'inline', progressInterval: 0 },
    );
    expect(runner.state).toBe('idle');
    runner.start();
    expect(runner.state).toBe('running');
    await wait(15);
    runner.pause();
    expect(runner.state).toBe('paused');
    await wait(60);
    const pausedAt = runner.result().generation;
    expect(pausedAt).toBeGreaterThan(0);
    expect(pausedAt).toBeLessThan(config.generations);
    await wait(60);
    expect(runner.result().generation).toBe(pausedAt); // really stopped
    expect(doneCount).toBe(0);

    // Pause and resume a few more times, including a quick pause/start.
    for (let i = 0; i < 3; i++) {
      runner.start();
      await wait(5);
      runner.pause();
      runner.start();
      await wait(5);
      runner.pause();
      await wait(30);
    }
    runner.start();
    while (runner.state !== 'done') await wait(10);
    expect(doneCount).toBe(1);
    expect(JSON.stringify(done)).toBe(JSON.stringify(uninterrupted.result));
    runner.start(); // no effect once done
    expect(runner.state).toBe('done');
    runner.dispose();
    expect(() => runner.start()).toThrow();
  });

  it('dispose stops a running runner', async () => {
    let doneCount = 0;
    const runner = createMeshRunner(target, smallConfig({ generations: 5000 }), { onDone: () => doneCount++ }, { executor: 'inline' });
    runner.start();
    await wait(20);
    runner.dispose();
    const at = runner.result().generation;
    await wait(60);
    expect(runner.result().generation).toBe(at);
    expect(doneCount).toBe(0);
  });

  it('zero generations finishes at once with the starting mesh', async () => {
    const { result } = await runToEnd(target, smallConfig({ generations: 0 }));
    expect(result.generation).toBe(0);
    expect(result).toEqual(meshResult(createMeshState(target, smallConfig({ generations: 0 }))));
  });

  it('rejects bad configs with a readable error', () => {
    expect(() => checkMeshConfig(target, { ...DEFAULT_MESH_CONFIG, points: 3 })).toThrow(/points/);
    expect(() => checkMeshConfig(target, { ...DEFAULT_MESH_CONFIG, seed: -1 })).toThrow(/seed/);
    expect(() => checkMeshConfig(target, { ...DEFAULT_MESH_CONFIG, jumpRate: 2 })).toThrow(/jumpRate/);
    expect(() => createMeshRunner(target, { ...DEFAULT_MESH_CONFIG, generations: 1.5 }, {}, { executor: 'inline' })).toThrow(/generations/);
    expect(() => createMeshRunner(target, DEFAULT_MESH_CONFIG, {}, { executor: 'worker' })).toThrow(/inline/);
  });

  it('presets exist and differ only in effort', () => {
    expect(Object.keys(MESH_QUALITY_PRESETS)).toEqual(['draft', 'standard', 'fine']);
    expect(MESH_QUALITY_PRESETS.draft.generations).toBeLessThan(MESH_QUALITY_PRESETS.standard.generations);
    expect(MESH_QUALITY_PRESETS.standard.generations).toBeLessThan(MESH_QUALITY_PRESETS.fine.generations);
  });

  it('works on a tiny image and on the most points that fit', async () => {
    const tiny = { width: 3, height: 2, data: new Uint8ClampedArray(3 * 2 * 4).fill(200) };
    for (const points of [8, 12]) {
      const { result } = await runToEnd(tiny, smallConfig({ points, generations: 5 }));
      expect(result.points.length).toBe(points);
      expect(result.score).toBe(0);
    }
  });
});

describe('meshToSVG', () => {
  it('writes one polygon per triangle, outlined in its own colour', async () => {
    const { result } = await runToEnd(target, smallConfig({ points: 30, generations: 3 }));
    const svg = meshToSVG(result);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain(`viewBox="0 0 ${width} ${height}"`);
    const polygons = svg.match(/<polygon [^>]*\/>/g) ?? [];
    expect(polygons.length).toBe(result.triangles.length);
    for (const polygon of polygons) {
      const fill = /fill="(#[0-9a-f]{6})"/.exec(polygon)?.[1];
      const stroke = /stroke="(#[0-9a-f]{6})"/.exec(polygon)?.[1];
      expect(fill).toBeDefined();
      expect(stroke).toBe(fill);
    }
  });
});

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
