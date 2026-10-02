// Plays finished animation frames as a loop on a canvas.
//
// Frames are pre-rendered to images at the canvas's size the first time they
// are needed, and again if the canvas changes size. Each animation tick then
// only draws one image. The speed can change while playing.

import type { FrameSource } from './exports/types';
import { frameImageSize, releaseFrameImage, renderFrameImage, type FrameImage } from './frameImages';

export interface LoopPlayer {
  /** The finished frames to loop through (new ones are rendered as needed). */
  setFrames(frames: FrameSource): void;
  /** Draw onto this canvas from now on (or nowhere, with null). */
  setCanvas(ctx: CanvasRenderingContext2D | null): void;
  /** Draw the current frame now, re-rendering the images if the canvas size changed. */
  redraw(): void;
  setFps(fps: number): void;
  play(): void;
  pause(): void;
  readonly playing: boolean;
  dispose(): void;
}

export function createLoopPlayer(): LoopPlayer {
  let frames: FrameSource | null = null;
  let images: FrameImage[] = [];
  let imageSize = { width: 0, height: 0 };
  let ctx: CanvasRenderingContext2D | null = null;
  let fps = 8;
  let playing = false;
  // Position in the loop, in frames; the fractional part is time until the next frame.
  let position = 0;
  let lastTime: number | null = null;
  let animationFrame = 0;
  let shownIndex = -1;

  function releaseImages(): void {
    for (const image of images) releaseFrameImage(image);
    images = [];
  }

  /** Make sure every frame has an image at the right size for the canvas. */
  function prepareImages(): void {
    if (!ctx || !frames || frames.count === 0) return;
    const wanted = frameImageSize(ctx.canvas.width, ctx.canvas.height, frames.count);
    if (wanted.width !== imageSize.width || wanted.height !== imageSize.height) {
      releaseImages();
      imageSize = wanted;
    }
    while (images.length < frames.count) {
      images.push(renderFrameImage(frames, images.length, imageSize.width, imageSize.height));
    }
  }

  function drawFrame(index: number): void {
    if (!ctx || !frames || frames.count === 0) return;
    prepareImages();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(images[index], 0, 0, ctx.canvas.width, ctx.canvas.height);
    shownIndex = index;
  }

  function currentIndex(): number {
    return !frames || frames.count === 0 ? 0 : Math.floor(position) % frames.count;
  }

  function tick(now: number): void {
    if (!playing) return;
    if (lastTime !== null && frames && frames.count > 0) {
      position = (position + ((now - lastTime) / 1000) * fps) % frames.count;
    }
    lastTime = now;
    const index = currentIndex();
    if (index !== shownIndex) drawFrame(index);
    animationFrame = requestAnimationFrame(tick);
  }

  return {
    setFrames(newFrames) {
      // Frames only ever get added, so existing images stay valid.
      frames = newFrames;
      if (frames.count < images.length) releaseImages();
      if (!playing) drawFrame(currentIndex());
    },
    setCanvas(newCtx) {
      ctx = newCtx;
      shownIndex = -1;
      drawFrame(currentIndex());
    },
    redraw() {
      shownIndex = -1;
      drawFrame(currentIndex());
    },
    setFps(newFps) {
      fps = newFps;
    },
    play() {
      if (playing) return;
      playing = true;
      lastTime = null;
      animationFrame = requestAnimationFrame(tick);
    },
    pause() {
      playing = false;
      cancelAnimationFrame(animationFrame);
    },
    get playing() {
      return playing;
    },
    dispose() {
      playing = false;
      cancelAnimationFrame(animationFrame);
      releaseImages();
      ctx = null;
    },
  };
}
