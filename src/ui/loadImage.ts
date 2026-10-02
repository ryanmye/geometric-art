// Turning a photo file into pixels the engine can use.

import type { Bitmap } from '../engine/types';

/** Decode an image file, turned the right way up according to its EXIF orientation. */
export async function decodeImage(blob: Blob): Promise<ImageBitmap> {
  if (blob.type && !blob.type.startsWith('image/')) {
    throw new Error(`That file does not look like an image (${blob.type}).`);
  }
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch (first) {
    // Older browsers reject the 'from-image' option; they apply EXIF by default.
    try {
      return await createImageBitmap(blob);
    } catch {
      const reason = first instanceof Error ? first.message : String(first);
      throw new Error(`Could not read that image. Try a JPEG or PNG. (${reason})`);
    }
  }
}

/** Fetch and decode an image from a URL (relative URLs are fine). */
export async function fetchImage(url: string): Promise<ImageBitmap> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url} (HTTP ${response.status}).`);
  return decodeImage(await response.blob());
}

/**
 * Working size for an image: the longest side becomes `longestSide`. The
 * short side is kept at 2 px or more (the mesh styles need at least 2 x 2),
 * which stretches only extremely thin images, such as 2000 x 20 at 128.
 */
export function workingSize(width: number, height: number, longestSide: number): { width: number; height: number } {
  const scale = longestSide / Math.max(width, height);
  return {
    width: Math.max(2, Math.round(width * scale)),
    height: Math.max(2, Math.round(height * scale)),
  };
}

/**
 * Resize the image so its longest side is `longestSide`, over a white
 * background (so transparent areas become white), and read back the pixels.
 *
 * Shrinking a large photo in one step can look grainy even with high-quality
 * smoothing, so we shrink by halves until within a factor of two, then do
 * the last step.
 */
export function toWorkingBitmap(image: CanvasImageSource & { width: number; height: number }, longestSide: number): Bitmap {
  const size = workingSize(image.width, image.height, longestSide);

  // First canvas: the largest "size times a power of two" that is no bigger
  // than the image itself.
  let width = size.width;
  let height = size.height;
  while (width * 2 <= image.width && height * 2 <= image.height) {
    width *= 2;
    height *= 2;
  }
  let canvas = makeCanvas(width, height);
  let ctx = context2d(canvas);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);

  // Halve until we reach the working size.
  while (width > size.width) {
    width /= 2;
    height /= 2;
    const smaller = makeCanvas(width, height);
    const smallerCtx = context2d(smaller);
    smallerCtx.drawImage(canvas, 0, 0, width, height);
    canvas = smaller;
    ctx = smallerCtx;
  }

  const imageData = ctx.getImageData(0, 0, width, height);
  return { width, height, data: imageData.data };
}

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('This browser cannot draw to a canvas.');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return ctx;
}
