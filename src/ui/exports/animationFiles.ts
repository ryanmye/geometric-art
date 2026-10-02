// Animation exports that only need the frames as pictures, so they work for
// any engine: a zip of PNG frames, a video, and a GIF.

import type { Bitmap } from '../../engine/types';
import type { GifOptions } from '../../export/gif';
import { createZip, type ZipEntry } from '../../render/zip';
import { canvasToPNG, drawToCanvas, outputSize } from './canvas';
import { recordVideo, videoExtension } from './recordVideo';
import type { AnimationExports } from './types';
import type { GifReply, GifRequest } from './gif.worker';

export interface ExportFile {
  name: string;
  blob: Blob;
}

/** Every frame as a PNG at the given longest side, in one .zip. */
export async function pngFramesZip(
  animation: AnimationExports,
  size: number,
  onProgress?: (done: number, total: number) => void,
): Promise<ExportFile> {
  const { frames } = animation;
  const entries: ZipEntry[] = [];
  const digits = String(frames.count).length;
  const pixels = outputSize(frames.width, frames.height, size);
  for (let i = 0; i < frames.count; i++) {
    onProgress?.(i, frames.count);
    const canvas = drawToCanvas(frames.width, pixels, (ctx, scale) => frames.draw(ctx, i, scale));
    const png = await canvasToPNG(canvas);
    const number = String(i + 1).padStart(Math.max(2, digits), '0');
    entries.push({ name: `frame-${number}.png`, data: new Uint8Array(await png.arrayBuffer()) });
  }
  onProgress?.(frames.count, frames.count);
  return {
    name: `${animation.baseName}-${size}px.zip`,
    blob: new Blob([createZip(entries) as BlobPart], { type: 'application/zip' }),
  };
}

export async function animationVideo(
  animation: AnimationExports,
  options: { fps: number; loops: number; size: number; onProgress?(done: number, total: number): void },
): Promise<ExportFile & { mimeType: string }> {
  const { blob, mimeType } = await recordVideo({ frames: animation.frames, ...options });
  return { name: `${animation.baseName}-${options.size}px.${videoExtension(mimeType)}`, blob, mimeType };
}

/**
 * GIF stores each frame's delay in hundredths of a second. The delay used for
 * `fps`, and the speed it actually plays at.
 */
export function gifTiming(fps: number): { delayMs: number; actualFps: number; rounded: boolean } {
  const centiseconds = Math.max(2, Math.round(100 / fps));
  const actualFps = 100 / centiseconds;
  return { delayMs: centiseconds * 10, actualFps, rounded: Math.abs(actualFps - fps) > 1e-9 };
}

/**
 * An animated GIF that loops forever. Frames are drawn here (with a pause
 * between frames so the page can update), then encoded in a worker.
 */
export async function animationGif(
  animation: AnimationExports,
  options: { fps: number; size: number; onProgress?(message: string): void },
): Promise<ExportFile & { encodeMs: number }> {
  const { frames } = animation;
  const pixels = outputSize(frames.width, frames.height, options.size);
  const bitmaps: Bitmap[] = [];
  for (let i = 0; i < frames.count; i++) {
    options.onProgress?.(`Drawing GIF frames… ${i} of ${frames.count}`);
    const canvas = drawToCanvas(frames.width, pixels, (ctx, scale) => frames.draw(ctx, i, scale));
    const image = (canvas.getContext('2d') as CanvasRenderingContext2D).getImageData(0, 0, pixels.width, pixels.height);
    bitmaps.push({ width: pixels.width, height: pixels.height, data: image.data });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  options.onProgress?.('Encoding GIF…');
  const started = performance.now();
  const bytes = await encodeInWorker(bitmaps, { delayMs: gifTiming(options.fps).delayMs, loop: 0 });
  const encodeMs = performance.now() - started;
  return {
    name: `${animation.baseName}-${options.size}px.gif`,
    blob: new Blob([bytes as BlobPart], { type: 'image/gif' }),
    encodeMs,
  };
}

function encodeInWorker(frames: Bitmap[], options: GifOptions): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./gif.worker.ts', import.meta.url), { type: 'module' });
    const finish = () => worker.terminate();
    worker.onmessage = (event: MessageEvent<GifReply>) => {
      finish();
      if (event.data.type === 'done') resolve(event.data.bytes);
      else reject(new Error(event.data.message));
    };
    worker.onerror = (event) => {
      event.preventDefault();
      finish();
      reject(new Error(`GIF encoder failed to run: ${event.message || 'unknown error'}`));
    };
    const request: GifRequest = { frames, options };
    // Hand the pixel buffers over instead of copying them.
    worker.postMessage(request, { transfer: frames.map((frame) => frame.data.buffer as ArrayBuffer) });
  });
}
