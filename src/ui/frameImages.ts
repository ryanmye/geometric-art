// Finished animation frames drawn once into images, so playing the loop is
// just copying one image per tick.

import type { FrameSource } from './exports/types';

export type FrameImage = ImageBitmap | HTMLCanvasElement;

/**
 * At most this many pixels across all pre-rendered frames (about 190 MB).
 * With many frames on a large high-density screen, frames are rendered a bit
 * smaller and scaled up when drawn, rather than using gigabytes.
 */
const PIXEL_BUDGET = 48_000_000;

/** Size to pre-render `count` frames at, for a canvas of the given pixel size. */
export function frameImageSize(width: number, height: number, count: number): { width: number; height: number } {
  const perFrame = PIXEL_BUDGET / Math.max(1, count);
  const shrink = Math.min(1, Math.sqrt(perFrame / (width * height)));
  return { width: Math.max(1, Math.round(width * shrink)), height: Math.max(1, Math.round(height * shrink)) };
}

/** Draw frame `index` into a new image of the given pixel size. */
export function renderFrameImage(frames: FrameSource, index: number, width: number, height: number): FrameImage {
  const scale = width / frames.width;
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      frames.draw(ctx as unknown as CanvasRenderingContext2D, index, scale);
      return canvas.transferToImageBitmap();
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  frames.draw(canvas.getContext('2d') as CanvasRenderingContext2D, index, scale);
  return canvas;
}

export function releaseFrameImage(image: FrameImage): void {
  if ('close' in image) image.close();
}
