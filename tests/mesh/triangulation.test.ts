import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/engine/rng';
import { buildTriangulation } from '../../src/mesh/buildTriangulation';
import { insertPoint } from '../../src/mesh/insertPoint';
import { beginJournal, commitJournal, undoJournal } from '../../src/mesh/journal';
import { inCircle, orient } from '../../src/mesh/predicates';
import { removePoint } from '../../src/mesh/removePoint';
import { clearTouched, type Triangulation } from '../../src/mesh/triangulation';
import { LONG_TEST_TIMEOUT } from '../timing';
import { bruteForceOwnerCheck, checkTriangulation } from './checkTriangulation';

/** Corners of a width x height image followed by the given points. */
function withCorners(width: number, height: number, points: Array<[number, number]>): [Int32Array, Int32Array] {
  const all: Array<[number, number]> = [[0, 0], [width, 0], [width, height], [0, height], ...points];
  return [Int32Array.from(all, (p) => p[0]), Int32Array.from(all, (p) => p[1])];
}

function randomPoints(seed: number, count: number, width: number, height: number): Array<[number, number]> {
  const rng = createRng(seed);
  const points: Array<[number, number]> = [];
  for (let i = 0; i < count; i++) points.push([rng.int(0, width), rng.int(0, height)]);
  return points;
}

function snapshot(tri: Triangulation): string {
  return JSON.stringify([
    Array.from(tri.corners), Array.from(tri.twin), Array.from(tri.alive),
    Array.from(tri.pointEdge), Array.from(tri.freeSlots.subarray(0, tri.freeCount)), tri.freeCount,
  ]);
}

describe('predicates', () => {
  it('orient and inCircle signs', () => {
    expect(orient(0, 0, 10, 0, 0, 10)).toBeGreaterThan(0);
    expect(orient(0, 0, 0, 10, 10, 0)).toBeLessThan(0);
    expect(orient(0, 0, 5, 5, 10, 10)).toBe(0);
    // Circle through (0,0), (10,0), (0,10): centre (5,5).
    expect(inCircle(0, 0, 10, 0, 0, 10, 5, 5)).toBeGreaterThan(0);
    expect(inCircle(0, 0, 10, 0, 0, 10, 10, 10)).toBe(0);
    expect(inCircle(0, 0, 10, 0, 0, 10, 20, 20)).toBeLessThan(0);
    // Exact at the largest size.
    expect(inCircle(0, 0, 4096, 0, 0, 4096, 4096, 4096)).toBe(0);
  });
});

describe('triangulation covers the image exactly once', { timeout: LONG_TEST_TIMEOUT }, () => {
  const cases: Array<[string, number, number, Array<[number, number]>]> = [
    ['random 300', 171, 256, randomPoints(1, 300, 171, 256)],
    ['random 50 small image', 9, 7, randomPoints(2, 50, 9, 7)],
    ['corners only', 20, 15, []],
    ['all on a horizontal line', 40, 30, Array.from({ length: 39 }, (_, i): [number, number] => [i + 1, 15])],
    ['all on a vertical line', 40, 30, Array.from({ length: 29 }, (_, i): [number, number] => [20, i + 1])],
    ['all on the diagonal', 40, 40, Array.from({ length: 39 }, (_, i): [number, number] => [i + 1, i + 1])],
    ['full grid (everything cocircular)', 12, 10, gridPoints(12, 10, 1)],
    ['coarse grid', 60, 40, gridPoints(60, 40, 5)],
    ['duplicates', 30, 30, [[5, 5], [5, 5], [10, 10], [10, 10], [10, 10], [0, 0], [30, 30], [15, 0], [15, 0]]],
    ['border points only', 30, 20, [[0, 5], [0, 10], [10, 0], [20, 0], [30, 7], [12, 20], [3, 20]]],
    ['points outside are skipped', 30, 20, [[-1, 5], [31, 5], [10, -3], [10, 10]]],
  ];
  for (const [name, width, height, points] of cases) {
    it(name, () => {
      const [xs, ys] = withCorners(width, height, points);
      const tri = buildTriangulation(xs, ys);
      expect(checkTriangulation(tri, width, height)).toEqual([]);
      expect(bruteForceOwnerCheck(tri, width, height)).toEqual([]);
    });
  }
});

function gridPoints(width: number, height: number, step: number): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  for (let y = 0; y <= height; y += step) {
    for (let x = 0; x <= width; x += step) points.push([x, y]);
  }
  return points;
}

describe('moving points (remove, then insert elsewhere)', () => {
  for (const [name, width, height, step, count] of [
    ['random', 171, 256, 0, 200],
    ['on a grid (many ties)', 40, 30, 5, 0],
  ] as Array<[string, number, number, number, number]>) {
    it(`stays valid and undo restores it exactly: ${name}`, () => {
      const points = step > 0 ? gridPoints(width, height, step).filter(([x, y]) => !isCorner(x, y, width, height)) : randomPoints(3, count, width, height);
      const [xs, ys] = withCorners(width, height, dedupe(points));
      const tri = buildTriangulation(xs, ys);
      const rng = createRng(99);
      let failures = 0;
      for (let move = 0; move < 2000; move++) {
        const p = rng.int(4, xs.length - 1);
        const before = snapshot(tri);
        const oldX = xs[p], oldY = ys[p];
        clearTouched(tri);
        beginJournal(tri.journal);
        let ok = removePoint(tri, p);
        // New position: anywhere, sometimes on the border or on a grid line.
        xs[p] = rng.next() < 0.2 ? (rng.next() < 0.5 ? 0 : width) : rng.int(0, width);
        ys[p] = rng.int(0, height);
        if (step > 0 && rng.next() < 0.5) xs[p] = Math.round(xs[p] / step) * step;
        if (ok) ok = insertPoint(tri, p, 0);
        if (!ok || rng.next() < 0.5) {
          if (!ok) failures++;
          undoJournal(tri.journal, tri);
          xs[p] = oldX;
          ys[p] = oldY;
          expect(snapshot(tri)).toBe(before);
        } else {
          commitJournal(tri.journal);
        }
        if (move % 100 === 0) expect(checkTriangulation(tri, width, height)).toEqual([]);
      }
      expect(checkTriangulation(tri, width, height)).toEqual([]);
      // Failures are only moves onto an existing point or removals of a corner.
      expect(failures).toBeLessThan(2000);
    });
  }

  it('corners cannot be removed', () => {
    const [xs, ys] = withCorners(50, 50, randomPoints(4, 30, 50, 50));
    const tri = buildTriangulation(xs, ys);
    for (let corner = 0; corner < 4; corner++) {
      beginJournal(tri.journal);
      expect(removePoint(tri, corner)).toBe(false);
      undoJournal(tri.journal, tri);
    }
    expect(checkTriangulation(tri, 50, 50)).toEqual([]);
  });
});

function isCorner(x: number, y: number, width: number, height: number): boolean {
  return (x === 0 || x === width) && (y === 0 || y === height);
}

function dedupe(points: Array<[number, number]>): Array<[number, number]> {
  const seen = new Set<string>();
  return points.filter((p) => {
    const key = `${p[0]},${p[1]}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
