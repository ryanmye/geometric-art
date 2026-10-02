// Messages between the page and the mesh worker. One worker runs either a
// single mesh or a whole seed animation (`animation` set).

import type { Bitmap } from '../engine/types';
import type { MeshAnimationResult, MeshAnimationSettings, MeshConfig, MeshResult } from './types';
import type { MeshWeighting } from './weights';

export type ToMeshWorker =
  | {
      type: 'init';
      target: Bitmap;
      config: MeshConfig;
      /** Already converted to whole numbers on the page side. */
      weighting: MeshWeighting | null;
      progressInterval: number;
      animation: MeshAnimationSettings | null;
    }
  | { type: 'start' }
  | { type: 'pause' };

export type FromMeshWorker =
  | { type: 'progress'; result: MeshResult; generation: number; frameIndex: number }
  | { type: 'done'; result: MeshResult }
  | { type: 'frameStart'; frameIndex: number; seed: number }
  | { type: 'frameDone'; result: MeshResult; frameIndex: number }
  | { type: 'animationDone'; result: MeshAnimationResult }
  | { type: 'error'; message: string };
