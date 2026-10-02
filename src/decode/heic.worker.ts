// Dedicated worker that decodes HEIC/HEIF photos off the main thread with
// libheif-js (libheif + libde265 compiled to WebAssembly). It is only started
// when a HEIC needs it (see libheifClient.ts), so neither this script nor the
// wasm is downloaded unless a visitor adds a HEIC in a browser without native
// support.
//
// What the page relies on (libheifClient.ts):
// - Loading failures are reported as 'unavailable', and the page then
//   discards this worker; nothing here outlives a failed load.
// - If libheif aborts or traps (out of memory, a bug hit by a hostile file),
//   its Emscripten runtime is left marked as aborted with its heap in an
//   unknown state, so the request fails as 'stopped' and the page discards
//   this worker. A plain error code from libheif (a damaged file) leaves the
//   runtime healthy and the worker is kept.

import { HeicDecodeError, type DecodeRequest, type HeicFailureKind, type WorkerMessage } from './heicMessages';
import { retryableMemo } from './retryableMemo';
import wasmUrl from 'libheif-js/libheif-wasm/libheif.wasm?url';
// The build warns that fs/path/crypto were "externalized for browser compatibility": this Emscripten glue requires them only on its Node.js path, Vite substitutes empty modules, and the browser never runs that path. (The package's other entry points are asm.js or embed the wasm as base64.)
import heifModuleFactory from 'libheif-js/libheif-wasm/libheif.js';

// libheif-js ships types only for the low-level exports, not for the
// HeifDecoder/HeifImage wrappers, so we describe what we use.
interface HeifImage {
  get_width(): number;
  get_height(): number;
  is_primary(): boolean;
  free(): void;
  display(
    target: { data: Uint8ClampedArray<ArrayBuffer>; width: number; height: number },
    callback: (result: { data: Uint8ClampedArray<ArrayBuffer>; width: number; height: number } | null) => void,
  ): void;
}

interface HeifDecoder {
  /** The libheif context of the last decode; the wrapper frees it only on the next decode. */
  decoder: number | null;
  decode(bytes: Uint8Array): HeifImage[];
}

interface HeifModule {
  HeifDecoder: new () => HeifDecoder;
  heif_context_free(context: number): void;
  HEAPU8: Uint8Array;
}

type HeifModuleFactory = (options: {
  instantiateWasm(imports: WebAssembly.Imports, done: (instance: WebAssembly.Instance, module: WebAssembly.Module) => unknown): unknown;
  onAbort(what: unknown): void;
}) => HeifModule;

const post = (message: WorkerMessage, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(message, transfer);
const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
const unavailable = (error: unknown) => new HeicDecodeError('unavailable', `Could not load the HEIC decoder (${reasonOf(error)}).`);
const stopped = (error: unknown) =>
  new HeicDecodeError('stopped', `The HEIC decoder stopped before finishing this photo; it may be too large for this device (${reasonOf(error)}).`);

/** Set once libheif has aborted: this worker must not decode anything else. */
let broken = false;
/** Fails the request in progress, for failures that surface outside its promise chain. */
let failCurrent: ((error: Error) => void) | null = null;
/** A compiled decoder handed over by the page (from an earlier worker), if any. */
let givenWasm: WebAssembly.Module | undefined;
/** Set once the decoder has loaded here (the page is sent the compiled module once). */
let loaded = false;

function breakDown(error: unknown): void {
  broken = true;
  failCurrent?.(stopped(error));
}
// libheif's display() decodes inside a setTimeout'd async function, so a trap
// there becomes an unhandled rejection rather than reaching our code.
self.addEventListener('unhandledrejection', (event) => {
  event.preventDefault();
  breakDown(event.reason);
});
self.addEventListener('error', (event) => {
  event.preventDefault();
  breakDown(event.error ?? event.message);
});

async function compileWasm(): Promise<WebAssembly.Module> {
  let response: Response;
  try {
    response = await fetch(wasmUrl);
  } catch (error) {
    throw unavailable(error);
  }
  if (!response.ok) throw unavailable(`HTTP ${response.status}`);
  try {
    const streamable = response.headers.get('content-type')?.startsWith('application/wasm');
    return streamable ? await WebAssembly.compileStreaming(response) : await WebAssembly.compile(await response.arrayBuffer());
  } catch (error) {
    throw unavailable(error);
  }
}

/** The decoder, loaded once per worker. A failure is not cached (and the page discards this worker anyway). */
const loadHeif = retryableMemo(async (): Promise<{ heif: HeifModule; compiledHere?: WebAssembly.Module }> => {
  const wasm = givenWasm ?? (await compileWasm());
  try {
    // Instantiate from our compiled module synchronously (the glue expects the
    // exports back at once), instead of letting the glue fetch it itself.
    const heif = (heifModuleFactory as unknown as HeifModuleFactory)({
      instantiateWasm: (imports, done) => done(new WebAssembly.Instance(wasm, imports), wasm),
      onAbort: breakDown,
    });
    return { heif, compiledHere: givenWasm ? undefined : wasm };
  } catch (error) {
    throw unavailable(error);
  }
});

function displayImage(image: HeifImage, width: number, height: number): Promise<Uint8ClampedArray<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    image.display({ data: new Uint8ClampedArray(width * height * 4), width, height }, (result) => {
      if (result) resolve(result.data);
      else reject(new HeicDecodeError('unsupported', 'This HEIC photo could not be decoded — it may use a codec this decoder does not support.'));
    });
  });
}

async function decode(id: number, buffer: ArrayBuffer): Promise<void> {
  const { heif, compiledHere } = await loadHeif();
  post({ type: 'loaded', id, wasm: loaded ? undefined : compiledHere });
  loaded = true;

  const decoder = new heif.HeifDecoder();
  let images: HeifImage[] = [];
  try {
    try {
      images = decoder.decode(new Uint8Array(buffer));
    } catch (error) {
      if (broken || error instanceof WebAssembly.RuntimeError) throw stopped(error);
      throw new HeicDecodeError('damaged', `That file could not be read as HEIC/HEIF (${reasonOf(error)}).`);
    }
    if (!images.length) {
      throw new HeicDecodeError('damaged', 'That file could not be read as HEIC/HEIF — it may be corrupt, or not actually be a HEIC/HEIF file.');
    }
    // A container can hold several top-level images (a burst, a depth map);
    // show the one the file marks as primary.
    const primary = images.find((image) => image.is_primary()) ?? images[0];
    const width = primary.get_width();
    const height = primary.get_height();
    if (!(width > 0 && height > 0)) throw new HeicDecodeError('damaged', 'That file could not be read as HEIC/HEIF — the photo has no size.');
    post({ type: 'decoding', id, pixels: width * height });

    // libheif applies the file's rotation and mirroring (irot/imir) itself.
    const data = await displayImage(primary, width, height);
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw stopped('no offscreen canvas');
    ctx.putImageData(new ImageData(data, width, height), 0, 0);
    const bitmap = canvas.transferToImageBitmap();
    post({ type: 'result', id, bitmap, width, height, imageCount: images.length, heapBytes: heif.HEAPU8.buffer.byteLength }, [bitmap]);
  } finally {
    // The wrapper keeps the last file's context (a copy of the file and its
    // parsed structures) in the wasm heap until the next decode; free it now.
    if (!broken) {
      try {
        for (const image of images) image.free();
        if (decoder.decoder) heif.heif_context_free(decoder.decoder);
        decoder.decoder = null;
      } catch (error) {
        breakDown(error);
      }
    }
  }
}

async function handle({ id, buffer, wasm }: DecodeRequest): Promise<void> {
  if (wasm && !loaded) givenWasm = wasm;
  try {
    if (broken) throw stopped('the decoder already failed');
    await new Promise<void>((resolve, reject) => {
      failCurrent = reject;
      decode(id, buffer).then(resolve, reject);
    });
  } catch (error) {
    let kind: HeicFailureKind = error instanceof HeicDecodeError ? error.kind : 'stopped';
    let message = error instanceof HeicDecodeError ? error.message : stopped(error).message;
    // Anything unexpected (e.g. a RangeError allocating pixels for a huge photo) also ends this worker.
    if (broken && kind !== 'unavailable') [kind, message] = ['stopped', stopped(error).message];
    post({ type: 'error', id, kind, message });
  } finally {
    failCurrent = null;
  }
}

// The page sends one request at a time, but run them in order regardless.
let queue: Promise<void> = Promise.resolve();
self.onmessage = (event: MessageEvent<DecodeRequest>) => {
  const request = event.data;
  queue = queue.then(() => handle(request));
};
