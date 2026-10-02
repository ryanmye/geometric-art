import { describe, expect, it } from 'vitest';
import { sobelMagnitude } from '../../src/importance/sobel';

describe('sobelMagnitude', () => {
  it('is zero everywhere on a flat field', () => {
    const luminance = new Float32Array(5 * 5).fill(128);
    const magnitude = sobelMagnitude(luminance, 5, 5);
    for (let i = 0; i < magnitude.length; i++) expect(magnitude[i]).toBe(0);
  });

  it('peaks on a sharp vertical edge, and is the same on every row', () => {
    const width = 8;
    const height = 4;
    const luminance = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) luminance[y * width + x] = x < width / 2 ? 0 : 255;
    }
    const magnitude = sobelMagnitude(luminance, width, height);
    for (let y = 0; y < height; y++) {
      const row = y * width;
      // Columns right at the edge (3, 4) are the strongest.
      expect(magnitude[row + 3]).toBeGreaterThan(magnitude[row + 1]);
      expect(magnitude[row + 4]).toBeGreaterThan(magnitude[row + 6]);
      // Every row looks the same (no y-dependence for a vertical edge).
      expect(magnitude[row + 3]).toBe(magnitude[3]);
    }
  });
});
