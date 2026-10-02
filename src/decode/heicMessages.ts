// Message shapes passed between the page (libheifClient.ts) and the HEIC
// decoding worker (heic.worker.ts), and the error type the page side throws.

/** Why a HEIC could not be decoded; decides both the message and whether the worker is kept. */
export type HeicFailureKind =
  | 'not-heic'
  // The decoder (worker script or wasm) could not be downloaded or started. Retrying can work.
  | 'unavailable'
  // The file itself is damaged, or uses something libheif cannot decode. The worker is fine.
  | 'damaged'
  | 'unsupported'
  // The decoder aborted, trapped, ran out of memory or stopped answering. The worker is discarded.
  | 'stopped';

export class HeicDecodeError extends Error {
  constructor(
    readonly kind: HeicFailureKind,
    message: string,
  ) {
    super(message);
    this.name = 'HeicDecodeError';
  }
}

/** Failures after which the worker must not be reused. */
export function isFatal(kind: HeicFailureKind): boolean {
  return kind === 'unavailable' || kind === 'stopped';
}

export interface DecodeRequest {
  type: 'decode';
  id: number;
  /** Transferred, not copied. */
  buffer: ArrayBuffer;
  /** The compiled decoder from an earlier worker, so a new worker needs no download or compile. */
  wasm?: WebAssembly.Module;
}

export type WorkerMessage =
  /** The decoder is ready in this worker. `wasm` is set the first time it was compiled here, for the page to keep. */
  | { type: 'loaded'; id: number; wasm?: WebAssembly.Module }
  /** The file parsed; the slow part (pixel decoding) starts now. */
  | { type: 'decoding'; id: number; pixels: number }
  | {
      type: 'result';
      id: number;
      /** Transferred, not copied. */
      bitmap: ImageBitmap;
      width: number;
      height: number;
      imageCount: number;
      /** Size of the decoder's WebAssembly memory afterwards; it never shrinks while the worker lives. */
      heapBytes: number;
    }
  | { type: 'error'; id: number; kind: HeicFailureKind; message: string };
