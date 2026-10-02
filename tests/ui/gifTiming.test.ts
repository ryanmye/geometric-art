import { describe, expect, it } from 'vitest';
import { gifTiming } from '../../src/ui/exports/animationFiles';

describe('GIF frame timing', () => {
  it('rounds the delay to hundredths of a second and says when the speed changed', () => {
    expect(gifTiming(10)).toEqual({ delayMs: 100, actualFps: 10, rounded: false });
    expect(gifTiming(25)).toEqual({ delayMs: 40, actualFps: 25, rounded: false });
    // 8 fps wants 12.5 hundredths; GIF can only store 13, which plays at about 7.69 fps.
    const eight = gifTiming(8);
    expect(eight.delayMs).toBe(130);
    expect(eight.actualFps).toBeCloseTo(7.692, 3);
    expect(eight.rounded).toBe(true);
  });

  it('never goes below 2 hundredths (browsers slow shorter delays right down)', () => {
    expect(gifTiming(60).delayMs).toBe(20);
  });
});
