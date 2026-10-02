// Turning a photo file into pixels the engine can use.

import type { Bitmap } from '../engine/types';
// Only the small file-type check and entry point are in the main bundle; the
// HEIC decoder itself (a worker and a WebAssembly file) is downloaded the
// first time a HEIC photo needs it.
import { decodeHeic, looksLikeHeic } from '../decode';
import { release, shrinkInSteps, type Size } from './shrinkPhoto';
import type { ShrinkReply, ShrinkRequest } from './shrink.worker';

/** Which decoder turned a file into pixels. */
export type DecoderPath = 'browser' | 'heic-native' | 'libheif-js';

export interface DecodedPhoto {
  bitmap: ImageBitmap;
  decoder: DecoderPath;
}

/** Set once a HEIC photo has been decoded with the downloaded decoder. */
let heicDecoderReady = false;

/**
 * The one place where a photo file becomes pixels. HEIC/HEIF photos (from
 * iPhones; recognised by their contents, whatever their name or type) go to
 * the HEIC decoder; everything else to the browser. `onStatus` hears what is
 * happening, e.g. that the HEIC decoder is being downloaded the first time.
 */
export async function decodePhotoFile(
  file: Blob & { name?: string },
  onStatus?: (text: string) => void,
): Promise<DecodedPhoto> {
  if (await looksLikeHeic(file)) {
    onStatus?.(heicDecoderReady ? 'decoding HEIC photo' : 'downloading the HEIC decoder (first time only)');
    let result;
    try {
      result = await decodeHeic(file);
    } catch (error) {
      // Mark it as a HEIC failure, so the message can say what went wrong.
      throw new Error(`HEIC: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (result.decoder === 'libheif-js') heicDecoderReady = true;
    return { bitmap: result.bitmap, decoder: result.decoder === 'native' ? 'heic-native' : 'libheif-js' };
  }
  return { bitmap: await decodeImage(file), decoder: 'browser' };
}

/**
 * Decode an image file in a format the browser knows, turned the right way up
 * according to its EXIF orientation. (Photo files go through decodePhotoFile
 * above, which also handles HEIC.)
 */
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
  try {
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
      release(canvas);
      canvas = smaller;
      ctx = smallerCtx;
    }

    const imageData = ctx.getImageData(0, 0, width, height);
    return { width, height, data: imageData.data };
  } finally {
    release(canvas);
  }
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

/**
 * Longest side of the copy kept for each loaded photo. Enough for the
 * largest working size (512) with room to spare and for comparing with the
 * original on screen, without holding full-size photos in memory (a 12
 * megapixel photo would take about 48 MB; this copy at most 4 MB).
 */
export const KEPT_PHOTO_SIZE = 1024;

/**
 * The copy of a photo the page keeps: the photo itself if its longest side is
 * at most KEPT_PHOTO_SIZE, otherwise a high-quality shrunk copy (made in
 * steps, see shrinkPhoto.ts). A larger photo is closed (released) here,
 * whether or not the copy could be made.
 *
 * The shrinking runs in a worker: for a 12000 x 9000 photo it takes about a
 * second, which on the page would stop it for that long. Browsers whose
 * workers cannot draw shrink on the page instead, pausing between steps.
 */
export async function keptCopy(photo: ImageBitmap): Promise<ImageBitmap> {
  if (Math.max(photo.width, photo.height) <= KEPT_PHOTO_SIZE) return photo;
  const target = workingSize(photo.width, photo.height, KEPT_PHOTO_SIZE);
  const worker = await startShrinkWorker();
  if (worker) return shrinkInWorker(worker, photo, target);
  return shrinkInSteps(photo, target, makeCanvas, nextTask);
}

/**
 * A new shrinking worker, once it is running; null if workers cannot draw
 * here or the worker could not start. (Waiting for it to start means the
 * photo is only handed over to a worker that can take it.)
 */
function startShrinkWorker(): Promise<Worker | null> {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./shrink.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      resolve(null);
      return;
    }
    worker.onmessage = () => resolve(worker); // its 'ready' message
    worker.onerror = (event) => {
      event.preventDefault();
      worker.terminate();
      resolve(null);
    };
  });
}

/** Hand `photo` to the worker (it is no longer usable here) and wait for the copy. One photo per worker. */
function shrinkInWorker(worker: Worker, photo: ImageBitmap, target: Size): Promise<ImageBitmap> {
  return new Promise((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<ShrinkReply>) => {
      worker.terminate();
      const reply = event.data;
      if (reply.type === 'done') resolve(reply.copy);
      else reject(new Error(reply.type === 'error' ? reply.message : 'The photo could not be shrunk.'));
    };
    worker.onerror = (event) => {
      event.preventDefault();
      worker.terminate(); // this also frees the photo, which the worker now holds
      reject(new Error(`The photo could not be shrunk (${event.message || 'unknown error'}).`));
    };
    const request: ShrinkRequest = { photo, target };
    worker.postMessage(request, { transfer: [photo] });
  });
}

/** Wait for the next task, so the page can respond and draw in between. */
function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** A small square thumbnail (cropped to fill), drawn once when a photo is added. */
export function makeThumbnail(photo: ImageBitmap, size = 112): HTMLCanvasElement {
  const canvas = makeCanvas(size, size);
  try {
    const ctx = context2d(canvas);
    const scale = size / Math.min(photo.width, photo.height);
    const width = photo.width * scale;
    const height = photo.height * scale;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(photo, (size - width) / 2, (size - height) / 2, width, height);
    return canvas;
  } catch (error) {
    release(canvas);
    throw error;
  }
}
