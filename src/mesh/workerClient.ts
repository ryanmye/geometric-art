// Page side of the mesh worker: create it, send the setup, pass its
// messages on, and turn crashes into one readable error.

import { workerError } from '../worker/workerFailure';
import type { FromMeshWorker, ToMeshWorker } from './messages';

export interface MeshWorkerClient {
  send(message: ToMeshWorker): void;
  terminate(): void;
}

export function startMeshWorker(
  init: ToMeshWorker,
  onMessage: (message: FromMeshWorker) => void,
  onFailure: (error: Error) => void,
): MeshWorkerClient {
  const worker = new Worker(new URL('./mesh.worker.ts', import.meta.url), { type: 'module' });
  let heardFrom = false;
  worker.onmessage = (event: MessageEvent<FromMeshWorker>) => {
    heardFrom = true;
    if (event.data.type === 'error') onFailure(new Error(`Mesh worker failed: ${event.data.message}`));
    else onMessage(event.data);
  };
  worker.onerror = (event) => {
    event.preventDefault();
    onFailure(workerError('Mesh worker', event, heardFrom));
  };
  worker.onmessageerror = () => onFailure(new Error('Mesh worker sent a message that could not be read'));
  // postMessage copies the pixels and weights.
  worker.postMessage(init);
  return {
    send: (message) => worker.postMessage(message),
    terminate: () => worker.terminate(),
  };
}
