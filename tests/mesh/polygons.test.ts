import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/engine/rng';
import type { Bitmap } from '../../src/engine/types';
import { computeImportance } from '../../src/importance';
import { parseMeshJSON } from '../../src/mesh/animationPlan';
import { createMeshAnimationRunner } from '../../src/mesh/animationRunner';
import { buildTriangulation } from '../../src/mesh/buildTriangulation';
import { cellOwners } from '../../src/mesh/cellOwners';
import { CELL_FIELDS, cellBox, commitCells, createCells, undoCells, updateCellsAfterMove } from '../../src/mesh/cells';
import { checkMeshConfig, DEFAULT_MESH_CONFIG, MESH_POLYGON_DEFAULTS } from '../../src/mesh/config';
import { insertPoint } from '../../src/mesh/insertPoint';
import { beginJournal, commitJournal, undoJournal } from '../../src/mesh/journal';
import { runGeneration } from '../../src/mesh/optimizer';
import { rasterizeMesh } from '../../src/mesh/rasterizeMesh';
import { removePoint } from '../../src/mesh/removePoint';
import { meshResult } from '../../src/mesh/result';
import { createMeshRunner } from '../../src/mesh/runner';
import { createMeshState, trackedError } from '../../src/mesh/state';
import { meshToAnimatedSVG } from '../../src/mesh/toAnimatedSVG';
import { meshToSVG } from '../../src/mesh/toSVG';
import { clearTouched } from '../../src/mesh/triangulation';
import type { MeshAnimationResult, MeshConfig, MeshResult, MeshRunnerOptions } from '../../src/mesh/types';
import { weightingFromOptions } from '../../src/mesh/weights';
import { loadFixture, smallConfig, squaredError } from './helpers';

const target = loadFixture();
const { width, height } = target;
const polygonConfig = (overrides: Partial<MeshConfig> = {}) => smallConfig({ cells: 'polygons', ...overrides });

function run(config: MeshConfig, options: MeshRunnerOptions = {}): Promise<MeshResult> {
  return new Promise((resolve, reject) => {
    createMeshRunner(target, config, { onDone: resolve, onError: reject }, { executor: 'inline', ...options }).start();
  });
}

function runAnimation(config: MeshConfig, frames: number, variation: number): Promise<MeshAnimationResult> {
  return new Promise((resolve, reject) => {
    createMeshAnimationRunner(target, config, { frames, variation }, { onDone: resolve, onError: reject }, { executor: 'inline' }).start();
  });
}

/** A target of random colours. */
function noise(w: number, h: number, seed: number): Bitmap {
  const rng = createRng(seed);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i++) data[i] = i % 4 === 3 ? 255 : rng.int(0, 255);
  return { width: w, height: h, data };
}

function withCorners(w: number, h: number, points: Array<[number, number]>): [Int32Array, Int32Array] {
  const seen = new Set<string>();
  const all: Array<[number, number]> = [];
  for (const p of [[0, 0], [w, 0], [w, h], [0, h], ...points] as Array<[number, number]>) {
    const key = p.join(',');
    if (!seen.has(key)) {
      seen.add(key);
      all.push(p);
    }
  }
  return [Int32Array.from(all, (p) => p[0]), Int32Array.from(all, (p) => p[1])];
}

/** Every cell's totals recomputed from brute-force owners, compared with the incremental ones. */
function expectCellsExact(cells: ReturnType<typeof createCells>, xs: Int32Array, ys: Int32Array, image: Bitmap): void {
  const points: Array<[number, number]> = Array.from(xs, (x, i) => [x, ys[i]]);
  const brute = cellOwners(points, image.width, image.height);
  let wrong = 0;
  for (let i = 0; i < brute.length; i++) if (brute[i] !== cells.owner[i]) wrong++;
  expect(wrong).toBe(0);
  const fresh = new Float64Array(CELL_FIELDS * xs.length);
  for (let i = 0; i < brute.length; i++) {
    const r = image.data[4 * i], g = image.data[4 * i + 1], b = image.data[4 * i + 2];
    const k = CELL_FIELDS * brute[i];
    fresh[k] += 1;
    fresh[k + 1] += r;
    fresh[k + 2] += g;
    fresh[k + 3] += b;
    fresh[k + 4] += r * r + g * g + b * b;
  }
  for (let k = 0; k < xs.length * CELL_FIELDS; k++) {
    if (k % CELL_FIELDS < 5) expect(cells.totals[k]).toBe(fresh[k]);
  }
}

function gridPoints(w: number, h: number, step: number): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  for (let y = 0; y <= h; y += step) for (let x = 0; x <= w; x += step) points.push([x, y]);
  return points;
}

describe('polygon cells: every pixel in exactly one cell, owners exact', () => {
  const cases: Array<[string, number, number, Array<[number, number]>]> = [
    ['random', 60, 40, Array.from({ length: 80 }, (_, i): [number, number] => [(i * 37) % 61, (i * 53) % 41])],
    ['grid (ties everywhere)', 30, 20, gridPoints(30, 20, 3)],
    ['odd grid (pixel centres equidistant from four points)', 31, 21, gridPoints(31, 21, 5)],
    ['collinear', 40, 30, Array.from({ length: 19 }, (_, i): [number, number] => [2 * i + 1, 15])],
    ['diagonal', 40, 40, Array.from({ length: 39 }, (_, i): [number, number] => [i + 1, i + 1])],
    ['border points', 40, 30, [[0, 7], [0, 20], [13, 0], [27, 0], [40, 3], [40, 29], [5, 30], [33, 30], [20, 15]]],
    ['corners only', 9, 7, []],
  ];
  for (const [name, w, h, points] of cases) {
    it(`${name}: built, then after many random moves (kept or undone)`, () => {
      const image = noise(w, h, 3);
      const [xs, ys] = withCorners(w, h, points);
      const tri = buildTriangulation(xs, ys);
      const cells = createCells(image, null, tri);
      expectCellsExact(cells, xs, ys, image);
      if (xs.length <= 4) return;

      const rng = createRng(17);
      const taken = new Set(Array.from(xs, (x, i) => `${x},${ys[i]}`));
      for (let move = 0; move < 400; move++) {
        const p = rng.int(4, xs.length - 1);
        // New place: anywhere free, sometimes on the border, sometimes on a grid line.
        let nx = rng.next() < 0.2 ? (rng.next() < 0.5 ? 0 : w) : rng.int(0, w);
        const ny = rng.int(0, h);
        if (rng.next() < 0.3) nx = Math.min(w, Math.round(nx / 5) * 5);
        if (taken.has(`${nx},${ny}`)) continue;
        const oldX = xs[p], oldY = ys[p];
        cellBox(cells, tri, p, cells.oldBox);
        clearTouched(tri);
        beginJournal(tri.journal);
        let ok = removePoint(tri, p);
        xs[p] = nx;
        ys[p] = ny;
        if (ok) ok = insertPoint(tri, p, 0);
        if (!ok) {
          undoJournal(tri.journal, tri);
          xs[p] = oldX;
          ys[p] = oldY;
          continue;
        }
        updateCellsAfterMove(cells, tri, p);
        if (rng.next() < 0.5) {
          commitJournal(tri.journal);
          commitCells(cells);
          taken.delete(`${oldX},${oldY}`);
          taken.add(`${nx},${ny}`);
        } else {
          undoJournal(tri.journal, tri);
          undoCells(cells);
          xs[p] = oldX;
          ys[p] = oldY;
        }
        if (move % 50 === 0) expectCellsExact(cells, xs, ys, image);
      }
      expectCellsExact(cells, xs, ys, image);
    });
  }
});

describe('polygon optimiser', () => {
  const importance = computeImportance(target, { strength: 1 });
  for (const weighted of [false, true]) {
    it(`incremental score equals a from-scratch rescore after many moves${weighted ? ' (weighted)' : ''}`, () => {
      const weighting = weighted ? weightingFromOptions({ weights: importance, importance: { strength: 1 } }, width, height) : null;
      const state = createMeshState(target, polygonConfig({ points: 150, generations: 40 }), weighting);
      for (let g = 0; g < 40; g++) runGeneration(state);
      expect(state.accepted).toBeGreaterThan(100);
      expect(state.refused).toBe(0);
      const cells = state.cells!;
      // Owners and totals equal a fresh set-up from the final points.
      const fresh = createCells(target, weighting ? weighting.weights : null, state.tri);
      expect(Array.from(cells.owner)).toEqual(Array.from(fresh.owner));
      expect(Array.from(cells.totals)).toEqual(Array.from(fresh.totals));
      expect(Array.from(cells.gain)).toEqual(Array.from(fresh.gain));
      expect(Array.from(cells.error)).toEqual(Array.from(fresh.error));
      expect(Array.from(cells.owner)).toEqual(Array.from(cellOwners(meshResult(state).points, width, height)));
      expect(trackedError(state)).toBe(fresh.error.reduce((a, b) => a + b, 0));

      // The reported score is exactly the error of the drawn (rasterised) mesh.
      const result = meshResult(state);
      const drawn = rasterizeMesh(result);
      expect(result.score).toBe(Math.sqrt(squaredError(drawn, target) / (3 * width * height)) / 255);
      if (weighting) {
        let total = 0;
        let sum = 0;
        for (let i = 0; i < width * height; i++) {
          sum += weighting.weights[i];
          for (let c = 0; c < 3; c++) total += weighting.weights[i] * (drawn.data[4 * i + c] - target.data[4 * i + c]) ** 2;
        }
        expect(result.weightedScore).toBe(Math.sqrt(total / (3 * sum)) / 255);
      }
    });
  }

  it('result: one polygon per point, outlines tile the image and match the pixel owners', async () => {
    const result = await run(polygonConfig({ points: 120, generations: 30 }));
    expect(result.triangles).toEqual([]);
    expect(result.config.cells).toBe('polygons');
    const polygons = result.polygons!;
    expect(polygons.map((p) => p.site)).toEqual(result.points.map((_, i) => i));
    let area = 0;
    for (const { vertices } of polygons) {
      for (let i = 0; i < vertices.length; i++) {
        const [ax, ay] = vertices[i];
        const [bx, by] = vertices[(i + 1) % vertices.length];
        area += ax * by - bx * ay;
      }
    }
    expect(Math.abs(area / 2 - width * height)).toBeLessThan(1); // corners are rounded to 0.01 px
    // Pixel centres clearly inside an outline belong to that cell.
    const owner = cellOwners(result.points, width, height);
    let checked = 0;
    for (let i = 0; i < width * height; i += 7) {
      const cx = (i % width) + 0.5, cy = Math.floor(i / width) + 0.5;
      const inside = polygons.filter((p) => insideBy(p.vertices, cx, cy, 0.05));
      if (inside.length === 0) continue; // within 0.05 px of an edge
      expect(inside.length).toBe(1);
      expect(inside[0].site).toBe(owner[i]);
      checked++;
    }
    expect(checked).toBeGreaterThan(width * height / 7 * 0.9);
    // JSON round trip.
    expect(parseMeshJSON(JSON.stringify(result))).toEqual(result);
  });

  it('is reproducible, and seeds differ', async () => {
    const a = await run(polygonConfig());
    const b = await run(polygonConfig());
    const c = await run(polygonConfig({ seed: 8 }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(c.points).not.toEqual(a.points);
  });

  it('all-ones weights give exactly the unweighted polygon mesh', async () => {
    const plain = await run(polygonConfig());
    const ones = await run(polygonConfig(), { weights: new Float32Array(width * height).fill(1), importance: { strength: 0, painted: false } });
    expect(ones.points).toEqual(plain.points);
    expect(ones.polygons).toEqual(plain.polygons);
    expect(ones.score).toBe(plain.score);
  });

  it('SVG output: one outlined polygon per cell, static and animated', async () => {
    const result = await run(polygonConfig({ points: 40, generations: 5 }));
    const svg = meshToSVG(result);
    const tags = svg.match(/<polygon [^>]*\/>/g) ?? [];
    expect(tags.length).toBe(40);
    for (const tag of tags) expect(tag).toMatch(/fill="(#[0-9a-f]{6})" stroke="\1"/);
    const animated = meshToAnimatedSVG(await runAnimation(polygonConfig({ points: 40, generations: 5 }), 2, 0.5), 4);
    expect(animated.match(/<polygon /g)?.length).toBe(80);
  });

  it('config: cells is checked; polygon defaults', () => {
    expect(() => checkMeshConfig(target, { ...DEFAULT_MESH_CONFIG, cells: 'hexagons' as 'polygons' })).toThrow(/cells/);
    expect(MESH_POLYGON_DEFAULTS.cells).toBe('polygons');
    expect('cells' in DEFAULT_MESH_CONFIG).toBe(false);
  });
});

describe('polygon animation', () => {
  const config = polygonConfig({ points: 80, generations: 30 });

  it('variation 1: frames are the independent runs; frame 0 is the single run', async () => {
    const animation = await runAnimation(config, 3, 1);
    for (let i = 0; i < 3; i++) expect(animation.frames[i]).toEqual(await run({ ...config, seed: config.seed + i }));
  });

  it('variation 0: identical frames', async () => {
    const animation = await runAnimation(config, 3, 0);
    for (const frame of animation.frames) {
      expect(frame.points).toEqual(animation.frames[0].points);
      expect(frame.polygons).toEqual(animation.frames[0].polygons);
    }
  });

  it('variation 0.3: frames start from frame 0, differ, and are reproducible', async () => {
    const a = await runAnimation(config, 3, 0.3);
    const b = await runAnimation(config, 3, 0.3);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.frames[0]).toEqual(await run(config));
    expect(a.frames[1].points).not.toEqual(a.frames[0].points);
    const same = a.frames[1].points.filter((p, i) => p.join() === a.frames[0].points[i].join()).length;
    expect(same).toBeGreaterThan(config.points / 2);
  });
});

describe('triangle outputs from before polygons existed', () => {
  // SHA-256 of the JSON exports, recorded before weights, animation and polygons were added.
  const pinned: Array<[Partial<MeshConfig>, string]> = [
    [{ seed: 2 }, '0fed864df2e0bc1ea9d11dee1f8af9adf5389ec0b0fa5d4c51d448917d3142c0'],
    [{ seed: 3, points: 600, generations: 100 }, 'cde9cb0a45cd2a31e9ba1c451d56fd323b5e4819f4b446e08812ecb90cbcdd08'],
  ];
  for (const [overrides, hash] of pinned) {
    it(`are byte-identical: ${JSON.stringify(overrides)}`, async () => {
      const result = await run({ ...DEFAULT_MESH_CONFIG, ...overrides });
      expect(createHash('sha256').update(JSON.stringify(result)).digest('hex')).toBe(hash);
    });
  }
});

/** Whether (x, y) is inside the clockwise-on-screen polygon by at least `margin` from every edge. */
function insideBy(vertices: Array<[number, number]>, x: number, y: number, margin: number): boolean {
  for (let i = 0; i < vertices.length; i++) {
    const [ax, ay] = vertices[i];
    const [bx, by] = vertices[(i + 1) % vertices.length];
    const length = Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2);
    if (length === 0) continue;
    const side = ((bx - ax) * (y - ay) - (by - ay) * (x - ax)) / length;
    if (side < margin) return false;
  }
  return true;
}
