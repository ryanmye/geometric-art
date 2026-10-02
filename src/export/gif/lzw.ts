// GIF's pixel data is compressed with LZW (Lempel-Ziv-Welch): a dictionary
// of "codes" starts out with one code per literal pixel value, and grows as
// repeated sequences of pixels are seen - each time the sequence we're
// building (`prefix` + next pixel `k`) has already been seen before, we
// extend it instead of emitting anything; the moment it's new, we emit the
// code for everything seen so far and add the extended sequence as a new
// code for next time. Codes are variable-width: they start at
// `minCodeSize + 1` bits (wide enough for a clear code, an end code, and one
// code per palette colour) and grow by a bit each time the dictionary
// outgrows the current width, up to 12 bits (4096 codes). When the
// dictionary is full, a clear code resets it and the width drops back down.
//
// This file only produces the raw, continuous stream of code bits packed
// into bytes (least-significant bit first, as GIF requires). Splitting that
// byte stream into GIF's 255-byte sub-blocks is the writer's job.

const MAX_CODE_BITS = 12;
const MAX_CODE_COUNT = 1 << MAX_CODE_BITS; // 4096: dictionary is reset once it would grow past this

/** Packs codes of varying bit width into bytes, LSB of the code first. */
class BitPacker {
  private bytes: number[] = [];
  private bitBuffer = 0; // bits waiting to be flushed into `bytes`, low bits first
  private bitCount = 0;

  writeCode(code: number, bits: number): void {
    this.bitBuffer |= code << this.bitCount;
    this.bitCount += bits;
    while (this.bitCount >= 8) {
      this.bytes.push(this.bitBuffer & 0xff);
      this.bitBuffer >>= 8;
      this.bitCount -= 8;
    }
  }

  /** Pads the last partial byte with zero bits and returns everything written. */
  finish(): Uint8Array {
    if (this.bitCount > 0) {
      this.bytes.push(this.bitBuffer & 0xff);
      this.bitBuffer = 0;
      this.bitCount = 0;
    }
    return new Uint8Array(this.bytes);
  }
}

/**
 * LZW-encodes a frame's palette indices for GIF.
 *
 * `minCodeSize` is the number of bits needed to hold the biggest palette
 * index (so a 2-colour palette needs 1, a 256-colour palette needs 8; GIF
 * requires at least 2). The clear code is 2^minCodeSize and the end code is
 * one more than that.
 */
export function lzwEncode(indices: Uint8Array, minCodeSize: number): Uint8Array {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  const firstFreeCode = endCode + 1;

  const packer = new BitPacker();

  // The dictionary is a trie: dict.get(prefixCode) is a map from the next
  // pixel value to the code representing prefixCode followed by that
  // value. Codes 0..clearCode-1 are pre-defined as "just this one pixel
  // value", so they never need a trie entry of their own as a prefix's
  // target - only as starting points.
  let dict = new Map<number, Map<number, number>>();
  let codeSize = minCodeSize + 1;
  let maxCode = (1 << codeSize) - 1;
  let nextCode = firstFreeCode;

  function reset(): void {
    dict = new Map();
    codeSize = minCodeSize + 1;
    maxCode = (1 << codeSize) - 1;
    nextCode = firstFreeCode;
  }

  // Writes one code, first widening codeSize once the dictionary has grown
  // past what the current width can address.
  //
  // The tricky part: a decoder only learns a new dictionary entry once it
  // has read the code that completes it (it needs that code's first pixel
  // value to know what the new entry is), so its dictionary is always
  // exactly one entry smaller than ours at the moment it reads any given
  // code. If we grew the width the instant our own dictionary passed a
  // power of two, the decoder - seeing one entry fewer at that point -
  // would still be reading the old, narrower width for that same code, and
  // the two sides would fall out of sync for the rest of the frame. So we
  // hold off growing until the dictionary is one entry past that (compare
  // against nextCode - 1, i.e. what the decoder's own count would be),
  // which keeps both sides agreeing on every code's width.
  function emit(code: number): void {
    if (nextCode - 1 > maxCode && codeSize < MAX_CODE_BITS) {
      codeSize++;
      maxCode = (1 << codeSize) - 1;
    }
    packer.writeCode(code, codeSize);
  }

  emit(clearCode);

  if (indices.length === 0) {
    emit(endCode);
    return packer.finish();
  }

  let prefixCode = indices[0]; // codes 0..clearCode-1 double as single-pixel codes
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const children = dict.get(prefixCode);
    const existing = children?.get(k);
    if (existing !== undefined) {
      prefixCode = existing;
      continue;
    }

    // prefixCode+k has never been seen: emit the code for prefixCode (the
    // longest known sequence ending just before this pixel) and learn the
    // new, one-longer sequence for next time.
    emit(prefixCode);

    if (nextCode < MAX_CODE_COUNT) {
      let entry = children;
      if (!entry) {
        entry = new Map();
        dict.set(prefixCode, entry);
      }
      entry.set(k, nextCode);
      nextCode++;
    } else {
      // Dictionary is full (reached the 12-bit/4096-code limit): tell the
      // decoder to clear its own dictionary and start fresh, the same way
      // we do here.
      emit(clearCode);
      reset();
    }

    prefixCode = k;
  }

  emit(prefixCode);
  emit(endCode);
  return packer.finish();
}
