import { describe, expect, it } from 'vitest';
import { clearMask, createMask, isMaskPainted, stampBrush, strokeBrush } from '../../src/paint/mask';

describe('stampBrush', () => {
  it('is full strength at the centre and untouched beyond the radius', () => {
    const width = 40;
    const height = 40;
    const mask = createMask(width, height);
    stampBrush(mask, width, height, 20, 20, 10, false);
    expect(mask[20 * width + 20]).toBe(255);
    // Well outside the radius: untouched.
    expect(mask[0 * width + 0]).toBe(0);
    expect(mask[39 * width + 39]).toBe(0);
  });

  it('falls off monotonically from centre to edge', () => {
    const width = 60;
    const height = 60;
    const mask = createMask(width, height);
    stampBrush(mask, width, height, 30, 30, 20, false);
    let previous = 256;
    for (let x = 30; x < 55; x++) {
      const value = mask[30 * width + x];
      expect(value).toBeLessThanOrEqual(previous);
      previous = value;
    }
  });

  it('does not write out of bounds when the stamp centre is near or past the border', () => {
    const width = 20;
    const height = 20;
    const positions: Array<[number, number]> = [
      [0, 0],
      [19, 19],
      [-5, -5],
      [25, 25],
      [0, 19],
      [19, 0],
    ];
    for (const [cx, cy] of positions) {
      const mask = createMask(width, height);
      expect(() => stampBrush(mask, width, height, cx, cy, 8, false)).not.toThrow();
      expect(mask.length).toBe(width * height);
    }
  });

  it('painting only ever raises a pixel, erasing only ever lowers it', () => {
    const width = 30;
    const height = 30;
    const mask = createMask(width, height);
    mask[15 * width + 15] = 100;
    const before = mask[15 * width + 15];
    stampBrush(mask, width, height, 15, 15, 10, false);
    expect(mask[15 * width + 15]).toBeGreaterThanOrEqual(before);

    stampBrush(mask, width, height, 15, 15, 10, true);
    const afterPaint = mask[15 * width + 15];
    stampBrush(mask, width, height, 15, 15, 10, true);
    expect(mask[15 * width + 15]).toBeLessThanOrEqual(afterPaint);
  });

  it('painting never exceeds 255 and erasing never goes below 0', () => {
    const width = 10;
    const height = 10;
    const mask = createMask(width, height);
    for (let i = 0; i < 5; i++) stampBrush(mask, width, height, 5, 5, 6, false);
    expect(mask[5 * width + 5]).toBeLessThanOrEqual(255);
    for (let i = 0; i < 5; i++) stampBrush(mask, width, height, 5, 5, 6, true);
    expect(mask[5 * width + 5]).toBeGreaterThanOrEqual(0);
  });
});

describe('strokeBrush', () => {
  it('leaves no gaps along a long, fast drag', () => {
    const width = 200;
    const height = 50;
    const mask = createMask(width, height);
    const radius = 6;
    strokeBrush(mask, width, height, 0, 25, 199, 25, radius, false);
    // Every point along the line should have been painted (nonzero), since
    // the stroke's stamps are spaced closer than the brush radius.
    for (let x = 0; x < width; x++) {
      expect(mask[25 * width + x]).toBeGreaterThan(0);
    }
  });
});

describe('clearMask / isMaskPainted', () => {
  it('reports nothing painted on a fresh mask, and something painted after a stamp', () => {
    const mask = createMask(10, 10);
    expect(isMaskPainted(mask)).toBe(false);
    stampBrush(mask, 10, 10, 5, 5, 3, false);
    expect(isMaskPainted(mask)).toBe(true);
  });

  it('zeroes everything on clear', () => {
    const mask = createMask(10, 10);
    stampBrush(mask, 10, 10, 5, 5, 3, false);
    clearMask(mask);
    expect(isMaskPainted(mask)).toBe(false);
    for (let i = 0; i < mask.length; i++) expect(mask[i]).toBe(0);
  });
});
