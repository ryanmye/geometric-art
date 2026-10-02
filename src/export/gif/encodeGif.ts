// Public entry point: turns a list of same-size frames into an animated
// GIF89a file, as raw bytes. See types.ts for the options, palette.ts for
// how colours are chosen, quantize.ts for how pixels are mapped onto them,
// lzw.ts and writer.ts for how the bytes are actually produced.

import type { Bitmap } from '../../engine/types';
import { buildPalette } from './palette';
import { quantizeFrames } from './quantize';
import { resolveOptions, type GifOptions } from './types';
import {
  ByteWriter,
  bitsForColorCount,
  colorTableSize,
  writeColorTable,
  writeGraphicControlExtension,
  writeHeader,
  writeImageData,
  writeImageDescriptor,
  writeLogicalScreenDescriptor,
  writeLoopExtension,
  writeTrailer,
} from './writer';

/**
 * Encodes `frames` (in playback order) as an animated GIF. Every frame must
 * be the same width and height; alpha is ignored (the GIF is fully opaque).
 */
export function encodeGif(frames: Bitmap[], options?: GifOptions): Uint8Array {
  if (frames.length === 0) throw new Error('encodeGif: need at least one frame');

  const { width, height } = frames[0];
  for (let i = 1; i < frames.length; i++) {
    if (frames[i].width !== width || frames[i].height !== height) {
      throw new Error(
        `encodeGif: all frames must be the same size; frame 0 is ${width}x${height} but frame ${i} is ` +
          `${frames[i].width}x${frames[i].height}`,
      );
    }
  }

  const resolved = resolveOptions(options);
  // GIF delay is stored in hundredths of a second (centiseconds).
  const delayCentiseconds = Math.max(0, Math.round(resolved.delayMs / 10));

  const writer = new ByteWriter();
  writeHeader(writer);

  if (resolved.palette === 'global') {
    const palette = buildPalette(frames, resolved.maxColors);
    const tableSize = colorTableSize(palette.length);
    const minCodeSize = bitsForColorCount(palette.length);
    const indexedFrames = quantizeFrames(frames, palette, resolved.dither);

    writeLogicalScreenDescriptor(writer, width, height, tableSize);
    writeColorTable(writer, palette, tableSize);
    writeLoopExtension(writer, resolved.loop);

    for (const indices of indexedFrames) {
      writeGraphicControlExtension(writer, delayCentiseconds);
      writeImageDescriptor(writer, width, height);
      writeImageData(writer, indices, minCodeSize);
    }
  } else {
    // Local palette mode: every frame picks its own best colours, at the
    // cost of one colour table per frame and the possibility of colours
    // drifting between frames.
    writeLogicalScreenDescriptor(writer, width, height, 0);
    writeLoopExtension(writer, resolved.loop);

    for (const frame of frames) {
      const palette = buildPalette([frame], resolved.maxColors);
      const tableSize = colorTableSize(palette.length);
      const minCodeSize = bitsForColorCount(palette.length);
      const [indices] = quantizeFrames([frame], palette, resolved.dither);

      writeGraphicControlExtension(writer, delayCentiseconds);
      writeImageDescriptor(writer, width, height, tableSize);
      writeColorTable(writer, palette, tableSize);
      writeImageData(writer, indices, minCodeSize);
    }
  }

  writeTrailer(writer);
  return writer.toUint8Array();
}
