import { describe, expect, it } from 'vitest';
import { createRunner } from '../../src/engine/runner';
import type { RunResult } from '../../src/engine/types';
import { loadFixture, runToEnd, smallConfig } from './helpers';

const target = loadFixture();

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('prefix', () => {
  it('continuing from the first shapes of a run, with the same seed, gives the same run', async () => {
    const config = smallConfig({ maxShapes: 12 });
    const full = await runToEnd(target, config);
    const prefix = full.result.shapes.slice(0, 5);
    const resumed = await runToEnd(target, config, { prefix });
    expect(resumed.result).toEqual(full.result);
    // Prefix shapes are not reported through onShape; the rest are, with their real index.
    expect(resumed.reported.map((r) => r.index)).toEqual([5, 6, 7, 8, 9, 10, 11]);
  });

  it('prefix shapes are painted first and count toward maxShapes', async () => {
    const first = await runToEnd(target, smallConfig({ seed: 1, maxShapes: 4 }));
    const other = await runToEnd(target, smallConfig({ seed: 2, maxShapes: 6 }), { prefix: first.result.shapes });
    expect(other.result.shapes.slice(0, 4)).toEqual(first.result.shapes);
    expect(other.result.shapes.length).toBe(6);
    expect(other.reported.length).toBe(2);
  });

  it('a prefix as long as maxShapes finishes at once', async () => {
    const first = await runToEnd(target, smallConfig({ maxShapes: 3 }));
    const again = await runToEnd(target, smallConfig({ maxShapes: 3 }), { prefix: first.result.shapes });
    expect(again.reported).toEqual([]);
    expect(again.result).toEqual(first.result);
  });
});

describe('runner', () => {
  it('pause stops after the current shape and resume carries on to the same result', async () => {
    const config = smallConfig({ maxShapes: 10 });
    const uninterrupted = await runToEnd(target, config);

    let doneCount = 0;
    let finished: RunResult | null = null;
    const runner = createRunner(
      target,
      config,
      {
        onShape: (_record, index) => {
          if (index === 2) runner.pause();
        },
        onDone: (result) => {
          doneCount++;
          finished = result;
        },
      },
      { executor: 'inline' },
    );
    expect(runner.state).toBe('idle');
    runner.start();
    expect(runner.state).toBe('running');

    // Wait for the pause to take effect (slow under load), then check it holds.
    for (let i = 0; i < 500 && runner.state === 'running'; i++) await wait(10);
    expect(runner.state).toBe('paused');
    expect(runner.result().shapes.length).toBe(3);
    await wait(100);
    expect(runner.result().shapes.length).toBe(3); // really stopped

    runner.start();
    while (runner.state !== 'done') await wait(10);
    expect(doneCount).toBe(1);
    expect(finished).toEqual(uninterrupted.result);
    expect(runner.result()).toEqual(uninterrupted.result);
    runner.dispose();
  });

  it('result() is a snapshot', async () => {
    const runner = createRunner(target, smallConfig({ maxShapes: 4 }), {}, { executor: 'inline' });
    const before = runner.result();
    expect(before.shapes).toEqual([]);
    expect(before.score).toBeGreaterThan(0);
    runner.start();
    while (runner.state !== 'done') await wait(10);
    expect(before.shapes).toEqual([]);
    expect(runner.result().shapes.length).toBe(4);
    runner.dispose();
  });

  it('a plain image that already matches its background finishes early', async () => {
    const data = new Uint8ClampedArray(8 * 8 * 4).fill(200);
    const { result } = await runToEnd({ width: 8, height: 8, data }, smallConfig());
    expect(result.shapes).toEqual([]);
    expect(result.score).toBe(0);
  });

  it('rejects a bad config with a readable error', () => {
    expect(() => createRunner(target, smallConfig({ shapeTypes: [] }), {}, { executor: 'inline' })).toThrow(
      /at least one shape type/,
    );
    expect(() => createRunner(target, smallConfig({ alpha: 0 }), {}, { executor: 'inline' })).toThrow(/alpha/);
  });
});
