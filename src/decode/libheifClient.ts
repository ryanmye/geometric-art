// Page side of the HEIC decoding worker (heic.worker.ts).
//
// Imported statically: a dynamic import() that fails once stays failed for
// the life of the page, so nothing that can fail to download sits behind one.
// The decoder itself (worker script and wasm) is reached only through
// `new Worker()` and the worker's own fetch, both of which simply run again
// on the next attempt.
//
// Lifetime of a worker:
// - Started by the first HEIC, then reused for the following ones.
// - Discarded (terminated) when it fails to load, when the decoder aborts or
//   stops answering, after a decode leaves its wasm memory above 160 MB
//   (wasm memory never shrinks; a 12-megapixel photo leaves about 66 MB, a
//   48-megapixel one about 257 MB), and after 30 s idle.
// - The compiled wasm is kept here once a worker has compiled it and given to
//   the next worker, so a replacement downloads and compiles nothing.

import { HeicDecodeError, isFatal, type DecodeRequest, type HeicFailureKind, type WorkerMessage } from './heicMessages';

export interface LibheifDecodeResult {
  bitmap: ImageBitmap;
  width: number;
  height: number;
  imageCount: number;
}

/** What the client needs from a Worker (a fake one in tests). */
export interface WorkerLike {
  postMessage(message: DecodeRequest, transfer: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null;
  onerror: ((event: Event) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
}

export interface LibheifClientOptions {
  createWorker: () => WorkerLike;
  /** To download and compile the decoder in a new worker. */
  loadMs?: number;
  /** To answer each step once loaded (parse; and the base for decoding). */
  stepMs?: number;
  /** Extra time for decoding, per megapixel. */
  msPerMegapixel?: number;
  idleMs?: number;
  retireHeapBytes?: number;
}

interface Slot {
  worker: WorkerLike;
  loaded: boolean;
  pending: { id: number; resolve(result: LibheifDecodeResult): void; reject(error: Error): void } | null;
  timer?: ReturnType<typeof setTimeout>;
}

const fail = (kind: HeicFailureKind, message: string) => new HeicDecodeError(kind, message);
const notLoaded = (why: string) => fail('unavailable', `Could not load the HEIC decoder (${why}).`);
const stoppedAnswering = () =>
  fail('stopped', 'The HEIC decoder stopped before finishing this photo; it may be too large for this device (no answer in time).');

export function createLibheifClient(options: LibheifClientOptions) {
  const { createWorker, loadMs = 60_000, stepMs = 15_000, msPerMegapixel = 1_000, idleMs = 30_000, retireHeapBytes = 160 * 2 ** 20 } = options;
  const stats = { workersStarted: 0, lastHeapBytes: 0 };
  let slot: Slot | null = null;
  let wasm: WebAssembly.Module | undefined;
  let nextId = 1;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let chain: Promise<unknown> = Promise.resolve();

  function retire(s: Slot): void {
    clearTimeout(s.timer);
    if (slot === s) slot = null;
    s.worker.onmessage = s.worker.onerror = s.worker.onmessageerror = null;
    s.worker.terminate();
  }

  function settle(s: Slot, error: HeicDecodeError | null, result?: LibheifDecodeResult, keep = true): void {
    const pending = s.pending;
    s.pending = null;
    clearTimeout(s.timer);
    if (!keep) retire(s);
    else if (slot === s) idleTimer = setTimeout(() => retire(s), idleMs);
    if (!pending) return;
    if (error) pending.reject(error);
    else pending.resolve(result!);
  }

  function arm(s: Slot, ms: number): void {
    clearTimeout(s.timer);
    s.timer = setTimeout(() => settle(s, s.loaded ? stoppedAnswering() : notLoaded('it took too long to download'), undefined, false), ms);
  }

  function start(): Slot {
    let worker: WorkerLike;
    try {
      worker = createWorker();
    } catch (error) {
      throw notLoaded(error instanceof Error ? error.message : String(error));
    }
    stats.workersStarted++;
    const s: Slot = { worker, loaded: false, pending: null };
    worker.onmessage = ({ data: message }) => {
      if (!s.pending || message.id !== s.pending.id) return;
      if (message.type === 'loaded') {
        s.loaded = true;
        if (message.wasm) wasm = message.wasm;
        arm(s, stepMs);
      } else if (message.type === 'decoding') {
        arm(s, stepMs + (msPerMegapixel * message.pixels) / 1e6);
      } else if (message.type === 'result') {
        const { bitmap, width, height, imageCount } = message;
        stats.lastHeapBytes = message.heapBytes;
        settle(s, null, { bitmap, width, height, imageCount }, message.heapBytes <= retireHeapBytes);
      } else {
        // A cached module that would not instantiate is dropped too.
        if (message.kind === 'unavailable') wasm = undefined;
        settle(s, fail(message.kind, message.message), undefined, !isFatal(message.kind));
      }
    };
    // A worker script that cannot be fetched (blocked, offline, 404) reports
    // only through this event, usually with no useful message.
    worker.onerror = (event) => {
      event.preventDefault();
      settle(s, s.loaded ? stoppedAnswering() : notLoaded('the decoder script did not start'), undefined, false);
    };
    worker.onmessageerror = () => settle(s, stoppedAnswering(), undefined, false);
    return s;
  }

  function run(buffer: ArrayBuffer): Promise<LibheifDecodeResult> {
    clearTimeout(idleTimer);
    return new Promise((resolve, reject) => {
      const s = slot ?? (slot = start());
      const id = nextId++;
      s.pending = { id, resolve, reject };
      arm(s, s.loaded ? stepMs : loadMs);
      const request: DecodeRequest = { type: 'decode', id, buffer, wasm: s.loaded ? undefined : wasm };
      try {
        s.worker.postMessage(request, [buffer]);
      } catch (error) {
        settle(s, notLoaded(error instanceof Error ? error.message : String(error)), undefined, false);
      }
    });
  }

  return {
    stats,
    /** Decode one HEIC/HEIF file's bytes (transferred to the worker). Calls run one at a time. */
    decode(buffer: ArrayBuffer): Promise<LibheifDecodeResult> {
      const result = chain.then(() => run(buffer));
      chain = result.catch(() => {});
      return result;
    },
    /** For checks: end the worker without telling the client, as the browser might. */
    killWorker(): void {
      slot?.worker.terminate();
    },
  };
}

const client = createLibheifClient({
  createWorker: () => new Worker(new URL('./heic.worker.ts', import.meta.url), { type: 'module' }) as WorkerLike,
});

export const decodeWithLibheif = client.decode;

// Dev server only (removed from the build): lets checks end the worker behind the client's back.
if (import.meta.env.DEV) (globalThis as { __heicDecoder?: typeof client }).__heicDecoder = client;
