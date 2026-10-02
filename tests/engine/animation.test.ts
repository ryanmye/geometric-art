import { describe, expect, it } from 'vitest';
import { createAnimationRunner } from '../../src/engine/animationRunner';
import {
  checkAnimationSettings,
  frameConfig,
  framePrefix,
  frameSeed,
  parseAnimationJSON,
  shapesAfterPrefix,
} from '../../src/engine/animationPlan';
import type { AnimationResult, AnimationSettings, Bitmap, RunConfig, RunnerOptions } from '../../src/engine/types';
import { loadFixture, runToEnd, smallConfig } from './helpers';

const target = loadFixture();

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface AnimationRun {
  result: AnimationResult;
  started: Array<{ frameIndex: number; seed: number }>;
  finished: number[];
  shapeEvents: number;
}

function animate(
  image: Bitmap,
  config: RunConfig,
  settings: AnimationSettings,
  options: Pick<RunnerOptions, 'workerCount'> = {},
): Promise<AnimationRun> {
  return new Promise((resolve, reject) => {
    const run: Omit<AnimationRun, 'result'> = { started: [], finished: [], shapeEvents: 0 };
    const runner = createAnimationRunner(
      image,
      config,
      settings,
      {
        onFrameStart: (frameIndex, seed) => run.started.push({ frameIndex, seed }),
        onShape: () => run.shapeEvents++,
        onFrameDone: (_frame, frameIndex) => run.finished.push(frameIndex),
        onDone: (result) => resolve({ ...run, result }),
        onError: reject,
      },
      { executor: 'inline', ...options },
    );
    runner.start();
  });
}

describe('animation planning', () => {
  it('frame i uses the base seed plus i, wrapping at 2^32', () => {
    expect(frameSeed(10, 0)).toBe(10);
    expect(frameSeed(10, 3)).toBe(13);
    expect(frameSeed(4294967295, 1)).toBe(0);
    const config = smallConfig({ seed: 100 });
    expect(frameConfig(config, 5)).toEqual({ ...config, seed: 105 });
    expect(config.seed).toBe(100); // not modified
  });

  it('frame 0 has no prefix; later frames share the first K shapes of frame 0', () => {
    const frame0 = { shapes: [1, 2, 3, 4, 5] } as unknown as Parameters<typeof framePrefix>[1];
    expect(framePrefix(0, null, 3)).toEqual([]);
    expect(framePrefix(2, frame0, 3)).toEqual([1, 2, 3]);
    expect(() => framePrefix(1, null, 3)).toThrow(/Frame 0/);
  });

  it('rejects bad settings', () => {
    const config = smallConfig({ maxShapes: 10 });
    expect(() => checkAnimationSettings({ frames: 0, shared: 0 }, config)).toThrow(/frames/);
    expect(() => checkAnimationSettings({ frames: 4, shared: 11 }, config)).toThrow(/Shared start/);
    expect(() => checkAnimationSettings({ frames: 4, shared: 10 }, config)).not.toThrow();
  });
});

describe('animation runner', () => {
  const config = smallConfig({ maxShapes: 10, seed: 20 });
  const settings = { frames: 4, shared: 4 };

  it('builds the frames as planned', async () => {
    const run = await animate(target, config, settings);
    const { result } = run;
    expect(result.frames.length).toBe(4);
    expect(run.started).toEqual([
      { frameIndex: 0, seed: 20 },
      { frameIndex: 1, seed: 21 },
      { frameIndex: 2, seed: 22 },
      { frameIndex: 3, seed: 23 },
    ]);
    expect(run.finished).toEqual([0, 1, 2, 3]);
    // Frame 0 reports all its shapes; later frames only those after the prefix.
    expect(run.shapeEvents).toBe(10 + 3 * 6);

    // Frame 0 is exactly a plain single-picture run with the base seed.
    const single = await runToEnd(target, config);
    expect(result.frames[0]).toEqual(single.result);

    // Every frame starts with frame 0's first K shapes ...
    expect(result.prefix).toEqual(single.result.shapes.slice(0, 4));
    for (const frame of result.frames) {
      expect(frame.shapes.length).toBe(10);
      expect(frame.shapes.slice(0, 4)).toEqual(result.prefix);
    }
    // ... and each later frame is exactly a run with its own seed and that prefix.
    for (let i = 1; i < 4; i++) {
      const alone = await runToEnd(target, { ...config, seed: 20 + i }, { prefix: result.prefix });
      expect(result.frames[i]).toEqual(alone.result);
    }
    // Frames differ after the shared start.
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) {
        expect(shapesAfterPrefix(result, i)).not.toEqual(shapesAfterPrefix(result, j));
      }
    }
  });

  it('is reproducible, whatever the number of (simulated) workers', async () => {
    const a = await animate(target, config, settings);
    const b = await animate(target, config, settings, { workerCount: 3 });
    expect(JSON.stringify(b.result)).toBe(JSON.stringify(a.result));
  });

  it('shared start 0 lets every frame differ from the first shape; K = all shapes freezes the picture', async () => {
    const free = await animate(target, config, { frames: 3, shared: 0 });
    expect(free.result.prefix).toEqual([]);
    expect(free.result.frames[1].shapes[0]).not.toEqual(free.result.frames[0].shapes[0]);

    const frozen = await animate(target, config, { frames: 3, shared: 10 });
    for (const frame of frozen.result.frames) expect(frame.shapes).toEqual(frozen.result.frames[0].shapes);
  });

  it('pause and resume across frames give the same result', async () => {
    const uninterrupted = await animate(target, config, settings);
    let finished: AnimationResult | null = null;
    const runner = createAnimationRunner(
      target,
      config,
      settings,
      {
        // Pause in the middle of frame 1 and right at the end of frame 2.
        onShape: (_record, index, frameIndex) => {
          if (frameIndex === 1 && index === 6) runner.pause();
        },
        onFrameDone: (_frame, frameIndex) => {
          if (frameIndex === 2) runner.pause();
        },
        onDone: (result) => (finished = result),
      },
      { executor: 'inline' },
    );
    runner.start();
    for (const expectedFrame of [1, 3]) {
      while (runner.state === 'running') await wait(5);
      await wait(100); // make sure it really stays stopped
      expect(runner.state).toBe('paused');
      expect(runner.frameIndex).toBe(expectedFrame);
      runner.start();
    }
    while (runner.state !== 'done') await wait(10);
    expect(finished).toEqual(uninterrupted.result);
    expect(runner.result()).toEqual(uninterrupted.result);
    expect(runner.currentFrame()).toBeNull();
    runner.dispose();
  });

  it('the JSON export reads back in', async () => {
    const { result } = await animate(target, config, { frames: 2, shared: 3 });
    const text = JSON.stringify({ ...result, fps: 8 }, null, 2);
    expect(parseAnimationJSON(text)).toEqual({ ...result, fps: 8 });
    expect(() => parseAnimationJSON(JSON.stringify(result.frames[0]))).toThrow(/not a Geometric Art animation/);
  });
});
