import type { Bitmap } from '../../src/engine/types';

/** A flat-colour bitmap, every pixel the same RGB. */
export function flatBitmap(width: number, height: number, rgb: [number, number, number] = [120, 80, 200]): Bitmap {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgb[0];
    data[i + 1] = rgb[1];
    data[i + 2] = rgb[2];
    data[i + 3] = 255;
  }
  return { width, height, data };
}

/** Black on the left half, white on the right half: one sharp vertical edge. */
export function verticalEdgeBitmap(width: number, height: number): Bitmap {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const value = x < width / 2 ? 0 : 255;
      const i = (y * width + x) * 4;
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

export function sumOf(values: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i];
  return sum;
}

export function meanOf(values: Float32Array): number {
  return sumOf(values) / values.length;
}
