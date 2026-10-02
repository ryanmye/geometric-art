import { describe, expect, it } from 'vitest';
import { boxBlur } from '../../src/importance/blur';

describe('boxBlur', () => {
  it('leaves a flat field unchanged exactly', () => {
    const data = new Float32Array(10 * 10).fill(5);
    const blurred = boxBlur(data, 10, 10, 2);
    for (let i = 0; i < blurred.length; i++) expect(blurred[i]).toBe(5);
  });

  it('does not let a bright left border raise values at the right border (and top does not raise the bottom)', () => {
    const width = 20;
    const height = 20;
    const data = new Float32Array(width * height);
    for (let y = 0; y < height; y++) data[y * width + 0] = 100; // bright left column
    for (const radius of [1, 3, 6]) {
      const blurred = boxBlur(data, width, height, radius);
      for (let y = 0; y < height; y++) expect(blurred[y * width + (width - 1)]).toBe(0);
    }

    const data2 = new Float32Array(width * height);
    for (let x = 0; x < width; x++) data2[0 * width + x] = 100; // bright top row
    for (const radius of [1, 3, 6]) {
      const blurred = boxBlur(data2, width, height, radius);
      for (let x = 0; x < width; x++) expect(blurred[(height - 1) * width + x]).toBe(0);
    }
  });

  it('spreads a single spike out, peaking at the centre (three passes, not one flat box)', () => {
    const width = 31;
    const height = 31;
    const cx = 15;
    const cy = 15;
    const data = new Float32Array(width * height);
    data[cy * width + cx] = 100;
    const blurred = boxBlur(data, width, height, 2); // default: three passes
    // The peak is still at the centre...
    const centre = blurred[cy * width + cx];
    expect(centre).toBeGreaterThan(0);
    // ...but neighbours now have some weight too, less than the centre
    // (a single box-blur pass alone would spread it into a flat plateau;
    // three passes is what gives it a Gaussian-like peak).
    expect(blurred[cy * width + cx + 1]).toBeGreaterThan(0);
    expect(blurred[cy * width + cx + 1]).toBeLessThan(centre);
    // Pixels well outside the radius*passes reach (6 pixels) are untouched.
    expect(blurred[0 * width + 0]).toBe(0);
  });

  it('radius 0 returns the input unchanged', () => {
    const data = new Float32Array([1, 2, 3, 4]);
    const blurred = boxBlur(data, 2, 2, 0);
    expect(Array.from(blurred)).toEqual([1, 2, 3, 4]);
  });

  it('gives the same output for the same input every time', () => {
    const data = new Float32Array(40 * 30);
    for (let i = 0; i < data.length; i++) data[i] = Math.sin(i) > 0 ? 50 : 0; // any fixed pattern
    const a = boxBlur(data, 40, 30, 3);
    const b = boxBlur(data, 40, 30, 3);
    expect(a).toEqual(b);
  });
});
