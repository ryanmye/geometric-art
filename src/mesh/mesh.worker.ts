// The mesh worker. A thin wrapper: it runs the same loops the inline
// runners run (loop.ts for one mesh, animationLoop.ts for a seed
// animation) and posts what they report back to the page.

import { createAnimationLoop } from './animationLoop';
import { createLoop } from './loop';
import type { FromMeshWorker, ToMeshWorker } from './messages';
import { createMeshState } from './state';

let loop: { start(): void; pause(): void } | null = null;

function reply(message: FromMeshWorker): void {
  self.postMessage(message);
}

const error = (e: Error) => reply({ type: 'error', message: e.message });

self.onmessage = (event: MessageEvent<ToMeshWorker>) => {
  const message = event.data;
  try {
    if (message.type === 'init') {
      const { target, config, weighting, progressInterval, animation } = message;
      if (animation) {
        loop = createAnimationLoop(target, config, animation, weighting, progressInterval, {
          frameStart: (frameIndex, seed) => reply({ type: 'frameStart', frameIndex, seed }),
          progress: (result, generation, frameIndex) => reply({ type: 'progress', result, generation, frameIndex }),
          frameDone: (result, frameIndex) => reply({ type: 'frameDone', result, frameIndex }),
          done: (result) => reply({ type: 'animationDone', result }),
          error,
        });
      } else {
        const state = createMeshState(target, config, weighting);
        loop = createLoop(state, progressInterval, {
          progress: (result, generation) => reply({ type: 'progress', result, generation, frameIndex: 0 }),
          done: (result) => reply({ type: 'done', result }),
          error,
        });
      }
      return;
    }
    if (!loop) throw new Error('Mesh worker used before init');
    if (message.type === 'start') loop.start();
    else if (message.type === 'pause') loop.pause();
  } catch (e) {
    error(e instanceof Error ? e : new Error(String(e)));
  }
};
