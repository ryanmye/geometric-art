import { describe, expect, it } from 'vitest';
import { computeLuminance } from '../../src/importance/luminance';
import { flatBitmap } from './helpers';

describe('computeLuminance', () => {
  it('is white for white and black for black', () => {
    expect(computeLuminance(flatBitmap(2, 2, [255, 255, 255]))[0]).toBeCloseTo(255, 3);
    expect(computeLuminance(flatBitmap(2, 2, [0, 0, 0]))[0]).toBe(0);
  });

  it('weighs green brightest and blue darkest, for equal channel values', () => {
    const data = new Uint8ClampedArray([100, 0, 0, 255, 0, 100, 0, 255, 0, 0, 100, 255, 0, 0, 0, 255]);
    const luminance = computeLuminance({ width: 2, height: 2, data });
    const [red, green, blue] = [luminance[0], luminance[1], luminance[2]];
    expect(green).toBeGreaterThan(red);
    expect(red).toBeGreaterThan(blue);
  });
});
