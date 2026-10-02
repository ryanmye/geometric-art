// Low-level GIF89a container writer: turns already-quantised frames (palette
// indices) plus a palette into the actual bytes of a .gif file. See
// encodeGif.ts for the public function that drives this; see lzw.ts for the
// pixel compression this calls out to.
//
// A GIF file is a flat sequence of blocks:
//   "GIF89a" header
//   logical screen descriptor (canvas size, whether there's a global palette)
//   global colour table (the palette, if present)
//   NETSCAPE2.0 application extension (loop count) - once, if looping
//   per frame:
//     graphic control extension (delay, transparency)
//     image descriptor (this frame's position and size)
//     [local colour table - not used here, every frame shares the global one]
//     LZW-compressed pixel data, split into sub-blocks
//   trailer byte (0x3B)
//
// Every multi-byte number in GIF is little-endian.

import { lzwEncode } from './lzw';
import type { PaletteColor } from './types';

/** Small append-only byte buffer; growing a plain array and converting once is fast enough here. */
export class ByteWriter {
  private bytes: number[] = [];

  byte(value: number): void {
    this.bytes.push(value & 0xff);
  }

  bytesRaw(values: ArrayLike<number>): void {
    for (let i = 0; i < values.length; i++) this.bytes.push(values[i] & 0xff);
  }

  /** ASCII text, one byte per character. */
  ascii(text: string): void {
    for (let i = 0; i < text.length; i++) this.bytes.push(text.charCodeAt(i));
  }

  /** 16-bit little-endian unsigned integer. */
  uint16(value: number): void {
    this.bytes.push(value & 0xff, (value >> 8) & 0xff);
  }

  toUint8Array(): Uint8Array {
    return new Uint8Array(this.bytes);
  }
}

/** Smallest power of two colour-table size (4 to 256) that fits `count` colours; GIF requires a power of two, minimum 2. */
export function colorTableSize(count: number): number {
  let size = 2;
  while (size < count && size < 256) size *= 2;
  return size;
}

/** How many bits are needed to index `count` colours (1 to 8). GIF's minimum LZW code size is 2. */
export function bitsForColorCount(count: number): number {
  let bits = 1;
  while (1 << bits < count) bits++;
  return Math.max(bits, 2);
}

/** Writes the global colour table: `tableSize` entries of 3 bytes (R,G,B), padding unused entries with black. */
export function writeColorTable(writer: ByteWriter, palette: PaletteColor[], tableSize: number): void {
  for (let i = 0; i < tableSize; i++) {
    const color = palette[i] ?? { r: 0, g: 0, b: 0 };
    writer.byte(color.r);
    writer.byte(color.g);
    writer.byte(color.b);
  }
}

export function writeHeader(writer: ByteWriter): void {
  writer.ascii('GIF89a');
}

/** `globalTableSize` of 0 means no global colour table (used when every frame carries its own local one instead). */
export function writeLogicalScreenDescriptor(
  writer: ByteWriter,
  width: number,
  height: number,
  globalTableSize: number,
): void {
  writer.uint16(width);
  writer.uint16(height);
  if (globalTableSize > 0) {
    // Packed byte: global colour table flag (1) | colour resolution (3 bits,
    // unused here, set to tableSize's bit depth) | sort flag (0) | size of
    // global colour table (3 bits, encoded as log2(size)-1).
    const sizeBits = Math.log2(globalTableSize) - 1;
    writer.byte(0x80 | (sizeBits << 4) | sizeBits);
  } else {
    writer.byte(0x00); // no global colour table
  }
  writer.byte(0); // background colour index (unused; every frame covers the whole canvas)
  writer.byte(0); // pixel aspect ratio: none
}

/** NETSCAPE2.0 application extension: the only standard way to say "loop the animation". */
export function writeLoopExtension(writer: ByteWriter, loopCount: number): void {
  writer.byte(0x21); // extension introducer
  writer.byte(0xff); // application extension label
  writer.byte(11); // block size: length of the application identifier + auth code below
  writer.ascii('NETSCAPE2.0');
  writer.byte(3); // sub-block size
  writer.byte(1); // sub-block id: "loop count follows"
  writer.uint16(loopCount); // 0 = loop forever
  writer.byte(0); // block terminator
}

/** Graphic control extension: per-frame timing. Comes right before that frame's image descriptor. */
export function writeGraphicControlExtension(writer: ByteWriter, delayCentiseconds: number): void {
  writer.byte(0x21); // extension introducer
  writer.byte(0xf9); // graphic control label
  writer.byte(4); // block size
  writer.byte(0x04); // packed byte: disposal method 1 ("do not dispose", keep as base for next frame) in bits 2-4, no transparency
  writer.uint16(delayCentiseconds);
  writer.byte(0); // transparent colour index (unused)
  writer.byte(0); // block terminator
}

/**
 * Image descriptor: this frame's placement (always the full canvas, at
 * 0,0). `localTableSize` is 0 when the frame uses the global palette
 * (encodeGif's default), or a colour-table size (as from colorTableSize)
 * when this frame carries its own local palette instead.
 */
export function writeImageDescriptor(writer: ByteWriter, width: number, height: number, localTableSize = 0): void {
  writer.byte(0x2c); // image separator
  writer.uint16(0); // left
  writer.uint16(0); // top
  writer.uint16(width);
  writer.uint16(height);
  if (localTableSize > 0) {
    const sizeBits = Math.log2(localTableSize) - 1;
    writer.byte(0x80 | sizeBits); // local colour table flag set, no interlace, no sort
  } else {
    writer.byte(0x00); // no local colour table, no interlace, no sort
  }
}

/** LZW-compresses `indices` and writes it as GIF's minCodeSize byte + length-prefixed sub-blocks + terminator. */
export function writeImageData(writer: ByteWriter, indices: Uint8Array, minCodeSize: number): void {
  writer.byte(minCodeSize);
  const compressed = lzwEncode(indices, minCodeSize);
  for (let offset = 0; offset < compressed.length; offset += 255) {
    const chunk = compressed.subarray(offset, Math.min(offset + 255, compressed.length));
    writer.byte(chunk.length);
    writer.bytesRaw(chunk);
  }
  if (compressed.length === 0) {
    // An empty frame (e.g. a 0-pixel image) still needs at least the LZW
    // end code; lzwEncode always emits one, so this branch should not
    // normally run, but guard the "no data at all" case for safety.
    writer.byte(0);
  }
  writer.byte(0); // block terminator
}

export function writeTrailer(writer: ByteWriter): void {
  writer.byte(0x3b);
}
