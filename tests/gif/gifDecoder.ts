// A minimal, independent GIF decoder used only by tests, so the test suite
// is not just checking the encoder against itself. It parses the container
// structure (header, screen descriptor, colour tables, extensions, image
// descriptors) and implements LZW decompression from scratch, deliberately
// not sharing any code with src/export/gif.

export interface DecodedFrame {
  /** Palette index per pixel, row-major, length width*height. */
  indices: Uint8Array;
  /** This frame's own colour table (the global one, copied in, if it has no local one). */
  palette: Array<[number, number, number]>;
  delayCentiseconds: number;
}

export interface DecodedGif {
  width: number;
  height: number;
  globalPalette: Array<[number, number, number]> | null;
  loopCount: number | null; // null if no NETSCAPE loop extension was found
  frames: DecodedFrame[];
}

class Reader {
  pos = 0;
  constructor(private bytes: Uint8Array) {}
  byte(): number {
    return this.bytes[this.pos++];
  }
  uint16(): number {
    const v = this.bytes[this.pos] | (this.bytes[this.pos + 1] << 8);
    this.pos += 2;
    return v;
  }
  bytes_(n: number): Uint8Array {
    const slice = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return slice;
  }
  ascii(n: number): string {
    let s = '';
    for (let i = 0; i < n; i++) s += String.fromCharCode(this.byte());
    return s;
  }
  /** Reads a sequence of length-prefixed sub-blocks until a zero-length terminator; returns the concatenated data. */
  readSubBlocks(): Uint8Array {
    const chunks: number[] = [];
    for (;;) {
      const len = this.byte();
      if (len === 0) break;
      for (let i = 0; i < len; i++) chunks.push(this.byte());
    }
    return new Uint8Array(chunks);
  }
}

function readColorTable(reader: Reader, size: number): Array<[number, number, number]> {
  const table: Array<[number, number, number]> = [];
  for (let i = 0; i < size; i++) {
    const r = reader.byte();
    const g = reader.byte();
    const b = reader.byte();
    table.push([r, g, b]);
  }
  return table;
}

/** Decompresses GIF LZW data back into palette indices. Mirrors the encoder's dictionary rules, written independently. */
export function lzwDecode(data: Uint8Array, minCodeSize: number, expectedPixelCount: number): Uint8Array {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  const firstFreeCode = endCode + 1;

  const output: number[] = [];

  // Bit reader over `data`, LSB-first, matching the encoder's packing.
  let bitBuffer = 0;
  let bitCount = 0;
  let bytePos = 0;
  function readCode(size: number): number {
    while (bitCount < size) {
      bitBuffer |= data[bytePos++] << bitCount;
      bitCount += 8;
    }
    const code = bitBuffer & ((1 << size) - 1);
    bitBuffer >>= size;
    bitCount -= size;
    return code;
  }

  // dictionary[code] = array of pixel values that code expands to.
  let dictionary: Uint8Array[] = [];
  let codeSize = minCodeSize + 1;
  let nextCode = firstFreeCode;

  function reset(): void {
    dictionary = [];
    for (let i = 0; i < clearCode; i++) dictionary[i] = new Uint8Array([i]);
    codeSize = minCodeSize + 1;
    nextCode = firstFreeCode;
  }
  reset();

  let prev: Uint8Array | null = null;
  for (;;) {
    const code = readCode(codeSize);
    if (code === clearCode) {
      reset();
      prev = null;
      continue;
    }
    if (code === endCode) break;

    let entry: Uint8Array;
    if (code < dictionary.length && dictionary[code]) {
      entry = dictionary[code];
    } else if (prev && code === nextCode) {
      // Classic LZW special case: code refers to the entry being defined
      // right now, which is prev + prev's own first byte.
      entry = new Uint8Array([...prev, prev[0]]);
    } else {
      throw new Error(`lzwDecode: invalid code ${code} (dictionary has ${dictionary.length} entries)`);
    }

    for (const value of entry) output.push(value);

    if (prev) {
      if (nextCode < (1 << 12)) {
        dictionary[nextCode] = new Uint8Array([...prev, entry[0]]);
        nextCode++;
        if (nextCode > (1 << codeSize) - 1 && codeSize < 12) codeSize++;
      }
    }
    prev = entry;

    if (output.length >= expectedPixelCount) break;
  }

  return Uint8Array.from(output.slice(0, expectedPixelCount));
}

export function decodeGif(bytes: Uint8Array): DecodedGif {
  const reader = new Reader(bytes);
  const signature = reader.ascii(6);
  if (signature !== 'GIF89a' && signature !== 'GIF87a') throw new Error(`Not a GIF: signature "${signature}"`);

  const width = reader.uint16();
  const height = reader.uint16();
  const packed = reader.byte();
  const hasGlobalTable = (packed & 0x80) !== 0;
  const globalTableSize = 1 << ((packed & 0x07) + 1);
  reader.byte(); // background colour index
  reader.byte(); // pixel aspect ratio

  const globalPalette = hasGlobalTable ? readColorTable(reader, globalTableSize) : null;

  const result: DecodedGif = { width, height, globalPalette, loopCount: null, frames: [] };
  let pendingDelay = 0;

  for (;;) {
    const marker = reader.byte();
    if (marker === 0x3b) break; // trailer

    if (marker === 0x21) {
      // Extension block.
      const label = reader.byte();
      if (label === 0xff) {
        // Application extension.
        const blockSize = reader.byte();
        const appId = reader.ascii(blockSize);
        const sub = reader.readSubBlocks();
        if (appId === 'NETSCAPE2.0' && sub.length >= 3 && sub[0] === 1) {
          result.loopCount = sub[1] | (sub[2] << 8);
        }
      } else if (label === 0xf9) {
        // Graphic control extension.
        reader.byte(); // block size (4)
        reader.byte(); // packed (disposal/transparency flags)
        pendingDelay = reader.uint16();
        reader.byte(); // transparent colour index
        reader.byte(); // block terminator
      } else {
        // Comment, plain text, or unknown extension: skip its sub-blocks.
        reader.readSubBlocks();
      }
      continue;
    }

    if (marker === 0x2c) {
      // Image descriptor.
      reader.uint16(); // left
      reader.uint16(); // top
      const frameWidth = reader.uint16();
      const frameHeight = reader.uint16();
      const imgPacked = reader.byte();
      const hasLocalTable = (imgPacked & 0x80) !== 0;
      const localTableSize = 1 << ((imgPacked & 0x07) + 1);
      const localPalette = hasLocalTable ? readColorTable(reader, localTableSize) : null;

      const minCodeSize = reader.byte();
      const compressed = reader.readSubBlocks();
      const pixelCount = frameWidth * frameHeight;
      const indices = lzwDecode(compressed, minCodeSize, pixelCount);

      const palette = localPalette ?? globalPalette;
      if (!palette) throw new Error('decodeGif: frame has no local or global colour table');
      result.frames.push({ indices, palette, delayCentiseconds: pendingDelay });
      continue;
    }

    throw new Error(`decodeGif: unexpected block marker 0x${marker.toString(16)}`);
  }

  return result;
}
