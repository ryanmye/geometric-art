import { describe, expect, it } from 'vitest';
import { toSVG } from '../../src/render/toSVG';
import type { RunResult } from '../../src/engine/types';

const config: RunResult['config'] = {
  seed: 1,
  shapeTypes: ['triangle'],
  alpha: 128,
  maxShapes: 5,
  climbs: 1,
  candidates: 1,
  maxAge: 1,
  errorBias: 0,
};

const result: RunResult = {
  version: 1,
  width: 100,
  height: 50,
  background: [10, 20, 30],
  config,
  score: 0.1,
  shapes: [
    {
      shape: { type: 'triangle', x1: 1, y1: 2, x2: 3, y2: 4, x3: 5, y3: 6 },
      color: [255, 0, 0],
      alpha: 255,
      score: 0.5,
    },
    {
      shape: { type: 'rectangle', x1: 1, y1: 2, x2: 11, y2: 22 },
      color: [0, 255, 0],
      alpha: 128,
      score: 0.4,
    },
    {
      shape: { type: 'rotatedRectangle', cx: 50, cy: 25, w: 20, h: 10, angle: 30 },
      color: [0, 0, 255],
      alpha: 64,
      score: 0.3,
    },
    {
      shape: { type: 'ellipse', cx: 40, cy: 20, rx: 5, ry: 8 },
      color: [255, 255, 0],
      alpha: 200,
      score: 0.2,
    },
    {
      shape: { type: 'rotatedEllipse', cx: 60, cy: 30, rx: 6, ry: 9, angle: 45 },
      color: [255, 0, 255],
      alpha: 1,
      score: 0.1,
    },
  ],
};

describe('toSVG', () => {
  const svg = toSVG(result);

  it('is well-formed XML with the right root element', () => {
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('viewBox="0 0 100 50"');
    expect(svg.trim().endsWith('</svg>')).toBe(true);
    // Every opened tag that isn't self-closing has a matching close; here all
    // element tags are self-closed, so just check tag balance roughly.
    const opens = svg.match(/<(svg)>/g) ?? [];
    const closes = svg.match(/<\/svg>/g) ?? [];
    expect(opens.length).toBe(0); // svg tag itself has attributes, not bare <svg>
    expect(closes.length).toBe(1);
  });

  it('draws the background rect first', () => {
    const bgIndex = svg.indexOf('<rect width="100" height="50" fill="rgb(10,20,30)"/>');
    expect(bgIndex).toBeGreaterThan(-1);
    const firstShapeIndex = svg.indexOf('<polygon');
    expect(bgIndex).toBeLessThan(firstShapeIndex);
  });

  it('renders a triangle as a polygon with the right points and fill', () => {
    expect(svg).toContain('<polygon points="1,2 3,4 5,6" fill="rgb(255,0,0)" fill-opacity="1"/>');
  });

  it('renders an axis-aligned rectangle as a rect with no transform', () => {
    expect(svg).toContain(
      '<rect x="1" y="2" width="10" height="20" fill="rgb(0,255,0)" fill-opacity="' + (128 / 255) + '"/>',
    );
  });

  it('renders a rotated rectangle as a rect with a rotate transform about its centre', () => {
    expect(svg).toContain(
      '<rect x="40" y="20" width="20" height="10" transform="rotate(30 50 25)" fill="rgb(0,0,255)" fill-opacity="' +
        64 / 255 +
        '"/>',
    );
  });

  it('renders an axis-aligned ellipse with no transform', () => {
    expect(svg).toContain(
      '<ellipse cx="40" cy="20" rx="5" ry="8" fill="rgb(255,255,0)" fill-opacity="' + 200 / 255 + '"/>',
    );
  });

  it('renders a rotated ellipse with a rotate transform about its centre', () => {
    expect(svg).toContain(
      '<ellipse cx="60" cy="30" rx="6" ry="9" transform="rotate(45 60 30)" fill="rgb(255,0,255)" fill-opacity="' +
        1 / 255 +
        '"/>',
    );
  });

  it('emits exactly one element per shape plus the background rect', () => {
    const rectCount = (svg.match(/<rect /g) ?? []).length;
    const ellipseCount = (svg.match(/<ellipse /g) ?? []).length;
    const polygonCount = (svg.match(/<polygon /g) ?? []).length;
    // 1 background rect + 1 plain rect + 1 rotated rect = 3 <rect
    expect(rectCount).toBe(3);
    expect(ellipseCount).toBe(2);
    expect(polygonCount).toBe(1);
  });

  it('rounds long coordinates to 0.01 px', () => {
    const long = toSVG({
      ...result,
      shapes: [
        {
          shape: { type: 'rotatedEllipse', cx: 10.123456789, cy: 20.987654321, rx: 3.005, ry: 4, angle: 12.3456 },
          color: [1, 2, 3],
          alpha: 255,
          score: 0.1,
        },
      ],
    });
    expect(long).toContain('<ellipse cx="10.12" cy="20.99" rx="3.01" ry="4" transform="rotate(12.35 10.12 20.99)"');
  });
});
