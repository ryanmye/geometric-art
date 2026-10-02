import { describe, expect, it } from 'vitest';
import { loadFixture, runToEnd, smallConfig } from './helpers';
import { rasterizeResult } from '../../src/engine/rasterizeResult';
import { createPicture } from '../../src/engine/picture';
import { fullTotal, totalToScore } from '../../src/engine/score';

const target = loadFixture();

describe('reproducibility', () => {
  it('same target, config and seed give the identical result', async () => {
    const a = await runToEnd(target, smallConfig());
    const b = await runToEnd(target, smallConfig());
    expect(a.result.shapes.length).toBe(12);
    expect(b.result).toEqual(a.result);
  });

  it('splitting the climbs between 1, 2, 3 or 5 simulated workers changes nothing', async () => {
    const config = smallConfig({ maxShapes: 10 });
    const one = await runToEnd(target, config, { workerCount: 1 });
    for (const workerCount of [2, 3, 5]) {
      const split = await runToEnd(target, config, { workerCount });
      expect(split.result).toEqual(one.result);
    }
  });

  it('different seeds give different shapes', async () => {
    const a = await runToEnd(target, smallConfig({ seed: 1, maxShapes: 5 }));
    const b = await runToEnd(target, smallConfig({ seed: 2, maxShapes: 5 }));
    expect(b.result.shapes).not.toEqual(a.result.shapes);
  });

  it('the reported score matches the repainted picture', async () => {
    const { result } = await runToEnd(target, smallConfig());
    const repainted = rasterizeResult(result);
    const picture = createPicture(target, result.background);
    const total = fullTotal(picture.target, repainted.data);
    expect(totalToScore(total, target.width, target.height)).toBeCloseTo(result.score, 12);
    // Every shape lowered the score.
    let previous = Infinity;
    for (const record of result.shapes) {
      expect(record.score).toBeLessThan(previous);
      previous = record.score;
    }
  });
});
