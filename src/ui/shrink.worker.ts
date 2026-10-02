// Shrinks a large photo off the main thread (see keptCopy in loadImage.ts).
// Shrinking a 12000 x 9000 photo takes about a second, and the page would
// not respond for that long if it did this itself.

import { shrinkInSteps, type Size } from './shrinkPhoto';

export interface ShrinkRequest {
  /** Transferred to the worker; closed here when done. */
  photo: ImageBitmap;
  target: Size;
}

export type ShrinkReply =
  /** Sent once at start, so the page knows the worker runs before handing it a photo. */
  | { type: 'ready' }
  | { type: 'done'; copy: ImageBitmap }
  | { type: 'error'; message: string };

function reply(message: ShrinkReply, transfer: Transferable[] = []): void {
  self.postMessage(message, { transfer });
}

self.onmessage = async (event: MessageEvent<ShrinkRequest>) => {
  const { photo, target } = event.data;
  try {
    const copy = await shrinkInSteps(photo, target, (width, height) => new OffscreenCanvas(width, height));
    reply({ type: 'done', copy }, [copy]);
  } catch (error) {
    reply({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};

reply({ type: 'ready' });
