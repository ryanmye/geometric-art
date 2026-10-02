import { describe, expect, it } from 'vitest';
import { frameSeed, parseMeshAnimationJSON, parseMeshJSON, replacedShare } from '../../src/mesh/animationPlan';
import { createMeshAnimationRunner } from '../../src/mesh/animationRunner';
import { createMeshRunner } from '../../src/mesh/runner';
import { meshToAnimatedSVG } from '../../src/mesh/toAnimatedSVG';
import type { MeshAnimationResult, MeshAnimationSettings, MeshConfig, MeshResult } from '../../src/mesh/types';
import { checkTriangulation } from './checkTriangulation';
import { buildTriangulation } from '../../src/mesh/buildTriangulation';
import { eventLoopTurns } from '../timing';
import { loadFixture, smallConfig } from './helpers';

const target = loadFixture();

function runSingle(config: MeshConfig): Promise<MeshResult> {
  return new Promise((resolve, reject) => {
    createMeshRunner(target, config, { onDone: resolve, onError: reject }, { executor: 'inline' }).start();
  });
}

function runAnimation(config: MeshConfig, settings: MeshAnimationSettings): Promise<MeshAnimationResult> {
  return new Promise((resolve, reject) => {
    createMeshAnimationRunner(target, config, settings, { onDone: resolve, onError: reject }, { executor: 'inline' }).start();
  });
}

const config = smallConfig({ points: 80, generations: 40 });

describe('mesh seed animation', () => {
  it('frame 0 is exactly the single run for the base seed', async () => {
    const animation = await runAnimation(config, { frames: 2, variation: 0.3 });
    expect(animation.frames[0]).toEqual(await runSingle(config));
    expect(animation.frames[1].config.seed).toBe(config.seed + 1);
  });

  it('variation 1: every frame is the independent single run with seed base + i', async () => {
    const animation = await runAnimation(config, { frames: 3, variation: 1 });
    for (let i = 0; i < 3; i++) {
      expect(animation.frames[i]).toEqual(await runSingle({ ...config, seed: frameSeed(config.seed, i) }));
    }
  });

  it('variation 0: every frame shows the same mesh as frame 0', async () => {
    const animation = await runAnimation(config, { frames: 4, variation: 0 });
    for (const frame of animation.frames) {
      expect(frame.points).toEqual(animation.frames[0].points);
      expect(frame.triangles).toEqual(animation.frames[0].triangles);
      expect(frame.score).toBe(animation.frames[0].score);
    }
  });

  it('in between, frames start from frame 0 and keep more of it the lower the variation', async () => {
    const kept = async (variation: number) => {
      const animation = await runAnimation(config, { frames: 3, variation });
      const first = animation.frames[0].points.map((p) => p.join(','));
      let same = 0;
      for (const frame of animation.frames.slice(1)) {
        expect(frame.points).not.toEqual(animation.frames[0].points);
        same += frame.points.filter((p, i) => p.join(',') === first[i]).length;
        // Still a valid mesh of the whole image.
        const xs = Int32Array.from(frame.points, (p) => p[0]);
        const ys = Int32Array.from(frame.points, (p) => p[1]);
        expect(checkTriangulation(buildTriangulation(xs, ys), target.width, target.height)).toEqual([]);
      }
      return same / (2 * config.points);
    };
    const low = await kept(0.1);
    const high = await kept(0.6);
    expect(low).toBeGreaterThan(high);
    expect(low).toBeGreaterThan(0.5);
    // The share mapping rises from 0 to 1.
    expect(replacedShare(0)).toBe(0);
    expect(replacedShare(1)).toBe(1);
    for (let v = 0; v < 1; v += 0.05) expect(replacedShare(v + 0.05)).toBeGreaterThan(replacedShare(v));
  });

  it('same settings give identical frames', async () => {
    const settings = { frames: 3, variation: 0.4 };
    const a = await runAnimation(config, settings);
    const b = await runAnimation(config, settings);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('pausing at a frame boundary and resuming gives the same animation, with events in order', async () => {
    const settings = { frames: 3, variation: 0.5 };
    const uninterrupted = await runAnimation(config, settings);
    const log: string[] = [];
    let finished: MeshAnimationResult | null = null;
    const runner = createMeshAnimationRunner(
      target,
      config,
      settings,
      {
        onFrameStart: (i, seed) => log.push(`start ${i} ${seed}`),
        onFrameDone: (_frame, i) => {
          log.push(`done ${i}`);
          if (i === 0) runner.pause();
        },
        onDone: (result) => {
          finished = result;
        },
      },
      { executor: 'inline', progressInterval: 0 },
    );
    runner.start();
    while (runner.frameIndex < 1) await wait(5);
    expect(runner.state).toBe('paused');
    await eventLoopTurns();
    expect(runner.frameIndex).toBe(1); // frame 1 did not start
    expect(runner.currentFrame()).toBeNull();
    expect(runner.result().frames.length).toBe(1);
    runner.start();
    await wait(3);
    runner.pause(); // and once more in the middle of a frame
    await wait(40);
    runner.start();
    while (runner.state !== 'done') await wait(5);
    expect(JSON.stringify(finished)).toBe(JSON.stringify(uninterrupted));
    expect(log).toEqual([
      `start 0 ${config.seed}`, 'done 0',
      `start 1 ${config.seed + 1}`, 'done 1',
      `start 2 ${config.seed + 2}`, 'done 2',
    ]);
    runner.dispose();
  });

  it('JSON export reads back to the same animation; other files are refused', async () => {
    const animation = await runAnimation(config, { frames: 2, variation: 0.3 });
    expect(parseMeshAnimationJSON(JSON.stringify(animation))).toEqual(animation);
    expect(parseMeshJSON(JSON.stringify(animation.frames[1]))).toEqual(animation.frames[1]);
    expect(() => parseMeshAnimationJSON(JSON.stringify(animation.frames[0]))).toThrow(/not a Geometric Art mesh animation/);
    expect(() => parseMeshJSON('{"kind":"animation"}')).toThrow(/not a Geometric Art mesh/);
  });

  it('animated SVG: one hidden group per frame, stepped CSS keyframes, no script, outlined triangles', async () => {
    const animation = await runAnimation(config, { frames: 3, variation: 0.3 });
    const svg = meshToAnimatedSVG(animation, 6);
    expect(svg).not.toContain('<script');
    expect(svg).toContain('@keyframes frame');
    expect(svg).toContain('animation: frame 0.5s step-end infinite');
    expect(svg.match(/<g class="f f\d+"/g)?.length).toBe(3);
    const polygons = svg.match(/<polygon /g)?.length ?? 0;
    expect(polygons).toBe(animation.frames.reduce((n, f) => n + f.triangles.length, 0));
    expect(svg).toMatch(/<polygon points="[^"]+" fill="(#[0-9a-f]{6})" stroke="\1"\/>/);
  });

  it('currentFrame() is only ever the frame being built: null from its start until its first progress', async () => {
    const seen: string[] = [];
    await new Promise<void>((resolve, reject) => {
      const runner = createMeshAnimationRunner(
        target,
        config,
        { frames: 3, variation: 0.5 },
        {
          onFrameStart: (i) => seen.push(`start ${i} ${runner.currentFrame() === null ? 'null' : 'frame'}`),
          onProgress: (_frame, _generation, i) => {
            const current = runner.currentFrame();
            if (!current || current.config.seed !== frameSeed(config.seed, i)) seen.push(`wrong frame during ${i}`);
          },
          onFrameDone: () => {
            if (runner.currentFrame() !== null) seen.push('not null after frame done');
          },
          onDone: () => resolve(),
          onError: reject,
        },
        { executor: 'inline', progressInterval: 0 },
      );
      runner.start();
    });
    expect(seen).toEqual(['start 0 null', 'start 1 null', 'start 2 null']);
  });

  it('rejects bad settings', () => {
    expect(() => createMeshAnimationRunner(target, config, { frames: 0, variation: 0.5 }, {}, { executor: 'inline' })).toThrow(/frames/);
    expect(() => createMeshAnimationRunner(target, config, { frames: 2, variation: 1.5 }, {}, { executor: 'inline' })).toThrow(/variation/);
  });
});

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
