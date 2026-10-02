import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLibheifClient, type WorkerLike } from '../../src/decode/libheifClient';
import { HeicDecodeError, type DecodeRequest, type WorkerMessage } from '../../src/decode/heicMessages';
import { skipReason } from '../../src/ui/photos/skipReason';

class FakeWorker implements WorkerLike {
  posted: Array<{ message: DecodeRequest; transfer: Transferable[] }> = [];
  terminated = false;
  onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  postMessage(message: DecodeRequest, transfer: Transferable[]): void {
    this.posted.push({ message, transfer });
  }
  terminate(): void {
    this.terminated = true;
  }
  get lastId(): number {
    return this.posted[this.posted.length - 1].message.id;
  }
  send(message: WorkerMessage): void {
    this.onmessage?.({ data: message } as MessageEvent<WorkerMessage>);
  }
  failToLoadScript(): void {
    this.onerror?.({ preventDefault() {} } as Event);
  }
  succeed(options: { wasm?: WebAssembly.Module; heapBytes?: number } = {}): void {
    const id = this.lastId;
    this.send({ type: 'loaded', id, wasm: options.wasm });
    this.send({ type: 'decoding', id, pixels: 256 * 171 });
    const bitmap = { width: 256, height: 171 } as ImageBitmap;
    this.send({ type: 'result', id, bitmap, width: 256, height: 171, imageCount: 1, heapBytes: options.heapBytes ?? 32 * 2 ** 20 });
  }
}

const compiled = { compiled: true } as unknown as WebAssembly.Module;
let workers: FakeWorker[];
let client: ReturnType<typeof createLibheifClient>;
const bytes = () => new ArrayBuffer(16);
/** Lets queued promise callbacks run (the client serialises calls through a promise chain). */
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  workers = [];
  client = createLibheifClient({
    createWorker: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    },
  });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('libheifClient: loading the decoder can always be retried', () => {
  it('a worker script that fails to load is discarded, and the next file starts a new one', async () => {
    const first = client.decode(bytes());
    await flush();
    workers[0].failToLoadScript();
    const error = await first.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HeicDecodeError);
    expect((error as HeicDecodeError).kind).toBe('unavailable');
    expect(skipReason(new Error(`HEIC: ${(error as Error).message}`))).toMatch(/decoder could not be downloaded/);
    expect(workers[0].terminated).toBe(true);

    const second = client.decode(bytes());
    await flush();
    expect(workers).toHaveLength(2);
    workers[1].succeed({ wasm: compiled });
    await expect(second).resolves.toMatchObject({ width: 256, height: 171 });
  });

  it('a worker whose wasm failed to download is not reused', async () => {
    const first = client.decode(bytes());
    await flush();
    workers[0].send({ type: 'error', id: workers[0].lastId, kind: 'unavailable', message: 'Could not load the HEIC decoder (Failed to fetch).' });
    await expect(first).rejects.toThrow(/Could not load the HEIC decoder/);
    expect(workers[0].terminated).toBe(true);

    const second = client.decode(bytes());
    await flush();
    expect(workers).toHaveLength(2);
    workers[1].succeed();
    await expect(second).resolves.toBeDefined();
  });

  it('a worker that cannot even be constructed is reported, and retried next time', async () => {
    let attempts = 0;
    client = createLibheifClient({
      createWorker: () => {
        attempts++;
        if (attempts === 1) throw new Error('SecurityError');
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
    });
    await expect(client.decode(bytes())).rejects.toThrow(/Could not load the HEIC decoder \(SecurityError\)/);
    const second = client.decode(bytes());
    await flush();
    workers[0].succeed();
    await expect(second).resolves.toBeDefined();
  });

  it('a download that never finishes fails after the load time, as a download failure', async () => {
    const first = client.decode(bytes());
    const outcome = first.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(((await outcome) as HeicDecodeError).kind).toBe('unavailable');
    expect(workers[0].terminated).toBe(true);
  });
});

describe('libheifClient: a loaded decoder is reused, a broken one never is', () => {
  it('reuses one worker across files, transferring each file and sending the wasm only to a new worker', async () => {
    for (let i = 0; i < 3; i++) {
      const buffer = bytes();
      const result = client.decode(buffer);
      await flush();
      expect(workers[0].posted[i].transfer).toEqual([buffer]);
      workers[0].succeed({ wasm: i === 0 ? compiled : undefined });
      await expect(result).resolves.toBeDefined();
    }
    expect(workers).toHaveLength(1);
    expect(client.stats.workersStarted).toBe(1);
    expect(workers[0].terminated).toBe(false);
  });

  it('a damaged file does not cost the worker', async () => {
    const bad = client.decode(bytes());
    await flush();
    workers[0].send({ type: 'loaded', id: workers[0].lastId });
    workers[0].send({ type: 'error', id: workers[0].lastId, kind: 'damaged', message: 'That file could not be read as HEIC/HEIF (bad box).' });
    const error = (await bad.catch((e: unknown) => e)) as Error;
    expect(skipReason(new Error(`HEIC: ${error.message}`))).toBe('a damaged HEIC photo');
    const good = client.decode(bytes());
    await flush();
    workers[0].succeed();
    await expect(good).resolves.toBeDefined();
    expect(workers).toHaveLength(1);
  });

  it('a decoder that aborted is discarded; its replacement gets the compiled wasm and downloads nothing', async () => {
    const first = client.decode(bytes());
    await flush();
    workers[0].succeed({ wasm: compiled });
    await first;

    const crash = client.decode(bytes());
    await flush();
    workers[0].send({ type: 'loaded', id: workers[0].lastId });
    workers[0].send({ type: 'error', id: workers[0].lastId, kind: 'stopped', message: 'The HEIC decoder stopped before finishing this photo (Aborted(OOM)).' });
    const error = (await crash.catch((e: unknown) => e)) as Error;
    expect(skipReason(new Error(`HEIC: ${error.message}`))).toMatch(/decoder stopped before finishing/);
    expect(workers[0].terminated).toBe(true);

    const next = client.decode(bytes());
    await flush();
    expect(workers).toHaveLength(2);
    expect(workers[1].posted[0].message.wasm).toBe(compiled);
    workers[1].succeed();
    await expect(next).resolves.toBeDefined();
  });

  it('a decode that never answers (worker killed) fails instead of hanging, and the next file works', async () => {
    const first = client.decode(bytes());
    await flush();
    workers[0].succeed({ wasm: compiled });
    await first;

    const hung = client.decode(bytes());
    const outcome = hung.catch((e: unknown) => e);
    await flush();
    workers[0].send({ type: 'loaded', id: workers[0].lastId });
    workers[0].send({ type: 'decoding', id: workers[0].lastId, pixels: 48e6 });
    await vi.advanceTimersByTimeAsync(15_000 + 1_000 * 48 - 1);
    expect(workers[0].terminated).toBe(false); // a 48-megapixel decode gets its time
    await vi.advanceTimersByTimeAsync(1);
    expect(((await outcome) as HeicDecodeError).kind).toBe('stopped');
    expect(workers[0].terminated).toBe(true);

    const next = client.decode(bytes());
    await flush();
    workers[1].succeed();
    await expect(next).resolves.toBeDefined();
  });

  it('a stray error from an idle worker discards it', async () => {
    const first = client.decode(bytes());
    await flush();
    workers[0].succeed();
    await first;
    workers[0].failToLoadScript();
    expect(workers[0].terminated).toBe(true);
    const next = client.decode(bytes());
    await flush();
    expect(workers).toHaveLength(2);
    workers[1].succeed();
    await next;
  });

  it('runs calls one at a time even if the caller does not wait', async () => {
    const a = client.decode(bytes());
    const b = client.decode(bytes());
    await flush();
    expect(workers[0].posted).toHaveLength(1);
    workers[0].succeed();
    await a;
    await flush();
    expect(workers[0].posted).toHaveLength(2);
    workers[0].succeed();
    await b;
  });
});

describe('libheifClient: memory', () => {
  it('ends the worker after a decode that grew its wasm memory past the limit', async () => {
    const big = client.decode(bytes());
    await flush();
    workers[0].succeed({ wasm: compiled, heapBytes: 600 * 2 ** 20 });
    await expect(big).resolves.toBeDefined();
    expect(workers[0].terminated).toBe(true);
  });

  it('ends an idle worker after 30 s, and the next file starts one from the kept wasm', async () => {
    const first = client.decode(bytes());
    await flush();
    workers[0].succeed({ wasm: compiled });
    await first;
    await vi.advanceTimersByTimeAsync(29_000);
    expect(workers[0].terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(workers[0].terminated).toBe(true);

    const next = client.decode(bytes());
    await flush();
    expect(workers[1].posted[0].message.wasm).toBe(compiled);
    workers[1].succeed();
    await next;
  });

  it('a busy worker is not ended by the idle timer', async () => {
    const first = client.decode(bytes());
    await flush();
    workers[0].succeed();
    await first;
    await vi.advanceTimersByTimeAsync(20_000);
    const second = client.decode(bytes());
    await flush();
    workers[0].send({ type: 'loaded', id: workers[0].lastId });
    workers[0].send({ type: 'decoding', id: workers[0].lastId, pixels: 12e6 });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(workers[0].terminated).toBe(false);
    workers[0].succeed();
    await second;
  });
});
