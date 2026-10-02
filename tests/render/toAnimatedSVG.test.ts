import { describe, expect, it } from 'vitest';
import { toAnimatedSVG } from '../../src/render/toAnimatedSVG';
import type { AnimationResult, RunResult, ShapeRecord } from '../../src/engine/types';

function record(x: number): ShapeRecord {
  return { shape: { type: 'rectangle', x1: x, y1: 0, x2: x + 5, y2: 5 }, color: [x, 0, 0], alpha: 128, score: 0.5 };
}

const config: RunResult['config'] = {
  seed: 10,
  shapeTypes: ['rectangle'],
  alpha: 128,
  maxShapes: 4,
  climbs: 1,
  candidates: 1,
  maxAge: 1,
  errorBias: 0,
};

function frame(seed: number, shapes: ShapeRecord[]): RunResult {
  return { version: 1, width: 40, height: 20, background: [1, 2, 3], config: { ...config, seed }, shapes, score: 0.1 };
}

// Two shared shapes (x = 1, 2); each of the 4 frames adds two of its own.
const prefix = [record(1), record(2)];
const animation: AnimationResult = {
  version: 1,
  kind: 'animation',
  width: 40,
  height: 20,
  background: [1, 2, 3],
  config,
  frameCount: 4,
  shared: 2,
  prefix,
  frames: [0, 1, 2, 3].map((i) => frame(10 + i, [...prefix, record(10 + i), record(20 + i)])),
};

describe('toAnimatedSVG', () => {
  const svg = toAnimatedSVG(animation, 8);

  it('is a standalone SVG with no script', () => {
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain('viewBox="0 0 40 20"');
    expect(svg.trim().endsWith('</svg>')).toBe(true);
    expect(svg).not.toMatch(/<script/i);
  });

  it('draws the background and the shared shapes once, before the frames', () => {
    expect(svg.match(/fill="rgb\(1,0,0\)"/g)?.length).toBe(1);
    expect(svg.match(/fill="rgb\(2,0,0\)"/g)?.length).toBe(1);
    const shared = svg.indexOf('<g id="shared">');
    expect(svg.indexOf('<rect width="40" height="20" fill="rgb(1,2,3)"/>')).toBeLessThan(shared);
    expect(shared).toBeLessThan(svg.indexOf('<g class="f f0">'));
  });

  it('has one group per frame holding only that frame’s own shapes', () => {
    for (let i = 0; i < 4; i++) {
      const start = svg.indexOf(`<g class="f f${i}">`);
      const end = svg.indexOf('</g>', start);
      const group = svg.slice(start, end);
      expect(group).toContain(`fill="rgb(${10 + i},0,0)"`);
      expect(group).toContain(`fill="rgb(${20 + i},0,0)"`);
      expect(group.match(/<rect /g)?.length).toBe(2);
    }
  });

  it('steps through the frames: 4 frames at 8 fps loop every 0.5 s, each shown for 25%', () => {
    expect(svg).toContain('@keyframes frame { 0% { visibility: visible; } 25%, 100% { visibility: hidden; } }');
    expect(svg).toContain('.f { visibility: hidden; animation: frame 0.5s step-end infinite; }');
    // Frame i starts (4 - i) frames into its cycle, so it is visible from i/8 s.
    expect(svg).toContain('.f1 { animation-delay: -0.375s; }');
    expect(svg).toContain('.f2 { animation-delay: -0.25s; }');
    expect(svg).toContain('.f3 { animation-delay: -0.125s; }');
  });
});
