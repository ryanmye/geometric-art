import type { Bitmap } from '../engine/types';

/**
 * Perceptual brightness of each pixel, 0 (black) to 255 (white), ignoring
 * alpha (the engine always hands us fully-opaque bitmaps). Standard
 * broadcast weights: green reads brightest to the eye, blue darkest.
 */
export function computeLuminance(target: Bitmap): Float32Array {
  const { width, height, data } = target;
  const luminance = new Float32Array(width * height);
  for (let p = 0, i = 0; p < luminance.length; p++, i += 4) {
    luminance[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return luminance;
}
