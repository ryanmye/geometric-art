// Showing a photo's stored result again, without rerunning: the picture (or
// the playing loop), its stats as they were when it finished, and its
// exports. It behaves like a finished run to the rest of the page.

import type { AnimationResult, RunResult } from '../../engine/types';
import { drawMesh, type MeshAnimationResult, type MeshResult } from '../../mesh';
import { drawResult } from '../../render/drawResult';
import type { AnimationExports, PictureExports } from '../exports/types';
import type { LoopControls } from '../loopControls';
import type { Stage } from '../stage';
import type { ActiveRun } from '../runs/activeRun';
import { createLoopView } from '../runs/loopView';
import { shapesPictureExports } from '../runs/shapesPicture';
import { meshPictureExports } from '../runs/meshPicture';
import { shapesAnimationExports } from '../runs/shapesAnimation';
import { meshAnimationExports } from '../runs/meshAnimation';
import type { StoredResult } from './storedResult';

/** The exports of a stored result: a picture's or an animation's. */
export function storedExports(stored: StoredResult): {
  picture: PictureExports | null;
  animation: AnimationExports | null;
} {
  const shapes = stored.style === 'shapes';
  if (stored.output === 'single') {
    const picture = shapes
      ? shapesPictureExports(stored.snapshot as RunResult)
      : meshPictureExports(stored.snapshot as MeshResult);
    return { picture, animation: null };
  }
  const animation = shapes
    ? shapesAnimationExports(stored.snapshot as AnimationResult)
    : meshAnimationExports(stored.snapshot as MeshAnimationResult);
  return { picture: null, animation };
}

export function createStoredRun(
  stored: StoredResult,
  context: { stage: Stage; photo: ImageBitmap },
  loop: LoopControls,
): ActiveRun {
  const { stage, photo } = context;
  const { picture, animation } = storedExports(stored);
  const size = { width: stored.snapshot.width, height: stored.snapshot.height };
  const view = animation ? createLoopView(loop, size, animation.frames.count) : null;

  return {
    style: stored.style,
    output: stored.output,
    note: stored.note,
    start() {
      if (picture) {
        stage.showDrawing(photo, size, (ctx, scale) => {
          if (stored.style === 'shapes') drawResult(ctx, stored.snapshot as RunResult, scale);
          else drawMesh(ctx, stored.snapshot as MeshResult, scale);
        });
      } else if (view && animation) {
        // The finished loop plays on the big picture straight away.
        view.show();
        stage.showDrawing(photo, size, () => view.redraw());
        view.frameDone(animation.frames);
        view.allDone(stage.context);
      }
    },
    pause() {},
    resume() {},
    dispose() {
      view?.dispose();
    },
    stats: () => stored.stats,
    pictureExports: () => picture,
    animationExports: () => animation,
    snapshot: () => stored.snapshot,
  };
}
