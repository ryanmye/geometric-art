import { describe, expect, it } from 'vitest';
import { importanceToBitmap } from '../../src/importance/visualize';

describe('importanceToBitmap', () => {
  it('maps the lowest weight to black and the highest to white', () => {
    const weights = new Float32Array([0.2, 1, 2]);
    const bitmap = importanceToBitmap(weights, 3, 1);
    expect(bitmap.data[0]).toBe(0); // first pixel, red channel: darkest
    expect(bitmap.data[8]).toBe(255); // third pixel: brightest
    expect(bitmap.data[3]).toBe(255); // alpha always opaque
  });

  it('produces an opaque bitmap of the right size', () => {
    const weights = new Float32Array(6).fill(1);
    const bitmap = importanceToBitmap(weights, 3, 2);
    expect(bitmap.width).toBe(3);
    expect(bitmap.height).toBe(2);
    expect(bitmap.data.length).toBe(3 * 2 * 4);
  });
});
