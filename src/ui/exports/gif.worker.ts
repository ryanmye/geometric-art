// Encodes a GIF off the main thread, so the page stays responsive. A thin
// wrapper around encodeGif from src/export/gif.

import { encodeGif, type GifOptions } from '../../export/gif';
import type { Bitmap } from '../../engine/types';

export interface GifRequest {
  frames: Bitmap[];
  options: GifOptions;
}

export type GifReply = { type: 'done'; bytes: Uint8Array } | { type: 'error'; message: string };

self.onmessage = (event: MessageEvent<GifRequest>) => {
  try {
    const bytes = encodeGif(event.data.frames, event.data.options);
    const reply: GifReply = { type: 'done', bytes };
    self.postMessage(reply, { transfer: [bytes.buffer] });
  } catch (error) {
    const reply: GifReply = { type: 'error', message: error instanceof Error ? error.message : String(error) };
    self.postMessage(reply);
  }
};
