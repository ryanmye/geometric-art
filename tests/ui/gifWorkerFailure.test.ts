// The GIF encoder worker (used by GIF export, Share GIF, Export all and Share
// all) must say plainly when its script could not be downloaded, and a later
// try must start a new worker rather than inherit the failure.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { animationGif } from '../../src/ui/exports/animationFiles';
import type { AnimationExports } from '../../src/ui/exports/types';
import { createShareFlow } from '../../src/ui/shareFiles';
import { WORKER_DOWNLOAD_FAILED } from '../../src/worker/workerFailure';

/** Workers that cannot be downloaded while `offline`, and otherwise answer with a tiny GIF. */
class FakeGifWorker {
  static offline = true;
  static created = 0;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  constructor() {
    FakeGifWorker.created++;
    const offline = FakeGifWorker.offline;
    setTimeout(() => {
      // A script that cannot be fetched: a plain error event with no message.
      if (offline) this.onerror?.(new Event('error'));
      else this.onmessage?.({ data: { type: 'done', bytes: new Uint8Array([71, 73, 70]) } } as MessageEvent);
    }, 0);
  }
  postMessage(): void {}
  terminate(): void {}
}

// No frames, so nothing needs a canvas; the encoder worker is still used.
const animation = { baseName: 'mona', frames: { width: 4, height: 4, count: 0, draw() {} } } as unknown as AnimationExports;
const gif = () => animationGif(animation, { fps: 8, size: 512 });

describe('GIF encoder worker that cannot be downloaded', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('fails with the plain download message, and works on the next try once online', async () => {
    vi.stubGlobal('Worker', FakeGifWorker);
    FakeGifWorker.offline = true;
    await expect(gif()).rejects.toThrow(WORKER_DOWNLOAD_FAILED);
    FakeGifWorker.offline = false;
    const file = await gif();
    expect(file.blob.type).toBe('image/gif');
  });

  it('gives Share GIF the same message once, and a later tap shares', async () => {
    vi.stubGlobal('Worker', FakeGifWorker);
    FakeGifWorker.offline = true;
    const errors: string[] = [];
    const share = vi.fn(async () => {});
    const flow = createShareFlow({
      prepare: async () => {
        const file = await gif();
        return [new File([file.blob], file.name, { type: 'image/gif' })];
      },
      key: () => [],
      onChange: () => {},
      // As shareButton.ts shows it.
      onError: (error) => errors.push(`Sharing failed: ${(error as Error).message}`),
      navigator: { share, canShare: () => true },
    });
    await flow.tap();
    expect(errors).toEqual([`Sharing failed: ${WORKER_DOWNLOAD_FAILED}`]);
    expect(flow.state).toBe('idle');
    FakeGifWorker.offline = false;
    await flow.tap();
    expect(share).toHaveBeenCalledTimes(1);
    expect(errors).toHaveLength(1);
  });
});
