import { describe, expect, it } from 'vitest';
import { buildPalette } from '../../src/export/gif/palette';
import type { Bitmap } from '../../src/engine/types';

function solidFrame(width: number, height: number, r: number, g: number, b: number): Bitmap {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  }
  return { width, height, data };
}

describe('buildPalette', () => {
  it('returns one colour for a solid image', () => {
    const palette = buildPalette([solidFrame(10, 10, 100, 150, 200)], 256);
    expect(palette).toHaveLength(1);
    expect(palette[0]).toEqual({ r: 100, g: 150, b: 200 });
  });

  it('never returns more colours than asked for', () => {
    const width = 64;
    const height = 64;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = Math.floor(Math.random() * 256);
      data[i + 1] = Math.floor(Math.random() * 256);
      data[i + 2] = Math.floor(Math.random() * 256);
      data[i + 3] = 255;
    }
    const palette = buildPalette([{ width, height, data }], 16);
    expect(palette.length).toBeLessThanOrEqual(16);
  });

  it('combines colours from every frame given', () => {
    const red = solidFrame(4, 4, 255, 0, 0);
    const blue = solidFrame(4, 4, 0, 0, 255);
    const palette = buildPalette([red, blue], 256);
    expect(palette.length).toBeGreaterThanOrEqual(2);
  });
});
