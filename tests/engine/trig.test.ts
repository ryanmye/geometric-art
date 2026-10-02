import { describe, expect, it } from 'vitest';
import { sinCosDegrees } from '../../src/engine/shapes/trig';

describe('sinCosDegrees', () => {
  it('agrees with Math.sin and Math.cos to about 1e-15', () => {
    for (let degrees = -720; degrees <= 720; degrees += 0.37) {
      const [s, c] = sinCosDegrees(degrees);
      // Reduce first so the reference itself is accurate.
      const radians = ((degrees % 360) * Math.PI) / 180;
      expect(Math.abs(s - Math.sin(radians))).toBeLessThan(2e-15);
      expect(Math.abs(c - Math.cos(radians))).toBeLessThan(2e-15);
    }
  });

  it('is exact at the quarter turns', () => {
    expect(sinCosDegrees(0)).toEqual([0, 1]);
    expect(sinCosDegrees(90)).toEqual([1, -0]);
    expect(sinCosDegrees(180)).toEqual([-0, -1]);
    expect(sinCosDegrees(270)).toEqual([-1, 0]);
  });
});
