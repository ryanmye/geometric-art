// A drawing worker whose script cannot be downloaded must say so in the
// visitor's words, and a later run (new workers) must not inherit the failure.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunConfig } from '../../src/engine/types';
import { startMeshWorker } from '../../src/mesh/workerClient';
import { createWorkerExecutor } from '../../src/worker/workerExecutor';
import { WORKER_DOWNLOAD_FAILED, workerError } from '../../src/worker/workerFailure';

/** What a browser hands to onerror when a worker script cannot be fetched: a plain Event, no message. */
const loadFailure = () => new Event('error');
/** What it hands over for an exception inside a running worker. */
const thrown = (message: string) => Object.assign(new Event('error'), { message });

describe('workerError', () => {
  it('says a part of the page could not be downloaded when the script never loaded', () => {
    expect(workerError('Search worker', loadFailure(), false).message).toBe(WORKER_DOWNLOAD_FAILED);
    expect(WORKER_DOWNLOAD_FAILED).toMatch(/could not be downloaded.*connection.*try again/i);
  });

  it('keeps the technical message for an error thrown inside a running worker', () => {
    expect(workerError('Mesh worker', thrown('Uncaught RangeError: x'), false).message).toBe('Mesh worker failed to run: Uncaught RangeError: x');
  });

  it('does not blame the download once the worker has been heard from', () => {
    expect(workerError('Mesh worker', loadFailure(), true).message).toBe('Mesh worker failed to run: unknown error');
  });
});

/** A Worker whose script "fails to download": it fires a plain error event soon after creation. */
class UnreachableWorker {
  static created = 0;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  constructor() {
    UnreachableWorker.created++;
    setTimeout(() => this.onerror?.(loadFailure()), 0);
  }
  postMessage(): void {}
  terminate(): void {}
}

describe('workers that cannot be downloaded', () => {
  afterEach(() => vi.unstubAllGlobals());
  const target = { width: 2, height: 2, data: new Uint8ClampedArray(16) };

  it('fail a shapes search with the download message, and a new executor tries again', async () => {
    vi.stubGlobal('Worker', UnreachableWorker);
    UnreachableWorker.created = 0;
    const config = { climbs: 2 } as RunConfig;
    const first = createWorkerExecutor(target, config, [], 2);
    await expect(first.search(0, 0)).rejects.toThrow(WORKER_DOWNLOAD_FAILED);
    first.dispose();
    const second = createWorkerExecutor(target, config, [], 2);
    expect(UnreachableWorker.created).toBe(4);
    await expect(second.search(0, 0)).rejects.toThrow(WORKER_DOWNLOAD_FAILED);
    second.dispose();
  });

  it('fail a mesh run with the download message', async () => {
    vi.stubGlobal('Worker', UnreachableWorker);
    const error = await new Promise<Error>((resolve) => {
      startMeshWorker({ type: 'start' }, () => {}, resolve);
    });
    expect(error.message).toBe(WORKER_DOWNLOAD_FAILED);
  });
});
