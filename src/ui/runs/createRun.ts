// The one place that picks the run for a style and output.
//
//                       single picture        seed animation
//   overlapping shapes  shapesPicture.ts      shapesAnimation.ts
//   triangle mesh       meshPicture.ts        meshAnimation.ts
//   polygon mosaic      meshPicture.ts        meshAnimation.ts   (the same files, cells: 'polygons')
//
// The loop of an animation (preview, playback, speed) is shared: loopView.ts.

import type { AnimationSettings, RunConfig } from '../../engine/types';
import type { MeshAnimationSettings, MeshConfig } from '../../mesh';
import type { LoopControls } from '../loopControls';
import type { ActiveRun, Output, RunContext, Style } from './activeRun';
import { createShapesPicture } from './shapesPicture';
import { createShapesAnimation } from './shapesAnimation';
import { createMeshPicture } from './meshPicture';
import { createMeshAnimation } from './meshAnimation';

export interface RunChoice {
  style: Style;
  output: Output;
  config: RunConfig;
  meshConfig: MeshConfig;
  /** Shapes animation: frames and shared start. */
  animation: AnimationSettings;
  /** Triangle-mesh and polygon-mosaic animation: frames and variation. */
  meshAnimation: MeshAnimationSettings;
}

export function createRun(choice: RunChoice, context: RunContext, loop: LoopControls): ActiveRun {
  if (choice.style === 'shapes') {
    return choice.output === 'animation'
      ? createShapesAnimation(context, choice.config, choice.animation, loop)
      : createShapesPicture(context, choice.config);
  }
  // Triangle mesh and polygon mosaic: meshConfig.cells says which.
  return choice.output === 'animation'
    ? createMeshAnimation(context, choice.style, choice.meshConfig, choice.meshAnimation, loop)
    : createMeshPicture(context, choice.style, choice.meshConfig);
}
