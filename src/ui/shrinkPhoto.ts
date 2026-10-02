// Shrinking a large photo in steps. Used by keptCopy (loadImage.ts), normally
// inside shrink.worker.ts so the page does not stop while a big photo is
// shrunk, and on the page itself only where workers cannot draw.

export interface Size {
  width: number;
  height: number;
}

/** A canvas in a worker (OffscreenCanvas) or on the page (HTMLCanvasElement). */
export type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;

/**
 * The canvas sizes to go through to shrink a `photo`-sized image to `target`:
 * first the largest "target times a power of two" that is no bigger than the
 * photo, then halves of it down to `target`. (The same sizes the page has
 * always used.)
 */
export function shrinkSteps(photo: Size, target: Size): Size[] {
  let { width, height } = target;
  while (width * 2 <= photo.width && height * 2 <= photo.height) {
    width *= 2;
    height *= 2;
  }
  const steps = [{ width, height }];
  while (width > target.width) {
    width /= 2;
    height /= 2;
    steps.push({ width, height });
  }
  return steps;
}

/**
 * Smoothing for the first step. That step shrinks by less than half on each
 * side for ordinary photos, and plain bilinear smoothing ('low') handles that
 * well. 'high' would also make Chrome build a mipmap (a stack of smaller
 * copies) of the full-size photo, about a third of its size again (140 MB for
 * a 12000 x 9000 photo), which Chrome kept long after the photo was released.
 * Only very thin images, whose short side cannot be doubled with the long
 * one, shrink by more than half (or stretch) in this step; they keep 'high'.
 */
export function firstStepQuality(photo: Size, first: Size): ImageSmoothingQuality {
  const shrinksByAtMostHalf = (from: number, to: number) => to <= from && to * 2 >= from;
  return shrinksByAtMostHalf(photo.width, first.width) && shrinksByAtMostHalf(photo.height, first.height) ? 'low' : 'high';
}

/**
 * Shrink `photo` to `target` in steps (see shrinkSteps). Each halving step is
 * drawn with 'low' smoothing: an exact halving averages each 2 x 2 block, which
 * gives the same pixels as 'high' here without building a mipmap. Every canvas
 * is emptied as soon as it has been used, and `photo` is closed, also when
 * something fails. `pause` (if given) runs between steps, e.g. to let the page
 * draw a frame.
 */
export async function shrinkInSteps(
  photo: ImageBitmap,
  target: Size,
  makeCanvas: (width: number, height: number) => AnyCanvas,
  pause?: () => Promise<void>,
): Promise<ImageBitmap> {
  let latest: AnyCanvas | null = null; // the last step drawn
  let next: AnyCanvas | null = null; // the step being drawn
  try {
    for (const step of shrinkSteps(photo, target)) {
      next = makeCanvas(step.width, step.height);
      if (latest) {
        drawSmoothed(next, latest, step, 'low');
        release(latest);
      } else {
        drawSmoothed(next, photo, step, firstStepQuality(photo, step));
        photo.close(); // the full-size photo is no longer needed
      }
      latest = next;
      await pause?.();
    }
    return await createImageBitmap(latest!);
  } finally {
    // Also when something above failed. Closing or releasing twice is harmless.
    photo.close();
    if (latest) release(latest);
    if (next) release(next);
  }
}

function drawSmoothed(canvas: AnyCanvas, source: CanvasImageSource, size: Size, quality: ImageSmoothingQuality): void {
  // Both canvas kinds have the same 2D context for what we use here.
  const ctx = (canvas as OffscreenCanvas).getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('This browser cannot draw to a canvas.');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = quality;
  ctx.drawImage(source, 0, 0, size.width, size.height);
}

/**
 * Free a canvas's pixels now. Chrome otherwise keeps a dropped canvas's memory
 * until garbage collection, which can be much later.
 */
export function release(canvas: AnyCanvas): void {
  canvas.width = 0;
  canvas.height = 0;
}
