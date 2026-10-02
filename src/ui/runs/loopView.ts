// The loop side of a seed animation, the same for every engine:
//
// while frames are computed, the big picture shows the frame being built
// (drawn by the run itself); once two frames are finished, a small preview in
// the Loop panel plays them; when all frames are done, the big picture plays
// the whole loop. Play/pause and the speed slider work throughout.

import type { FrameSource } from '../exports/types';
import type { LoopControls } from '../loopControls';
import { createLoopPlayer } from '../loopPlayer';

export interface LoopView {
  /** Show the Loop panel (call when the run starts). */
  show(): void;
  /** A frame finished; `frames` holds every finished frame so far. */
  frameDone(frames: FrameSource): void;
  /** Every frame is done: move the loop onto the big picture. */
  allDone(stageContext: CanvasRenderingContext2D): void;
  /** True once the big picture plays the loop (the run should not draw over it). */
  readonly onStage: boolean;
  /** Redraw the loop's current frame (after the big picture changed size). */
  redraw(): void;
  dispose(): void;
}

export function createLoopView(
  loop: LoopControls,
  imageSize: { width: number; height: number },
  frameCount: number,
): LoopView {
  const player = createLoopPlayer();
  player.setFps(loop.fps);
  let finished = 0;
  let onStage = false;

  function updatePanel(): void {
    const enough = finished >= 2;
    loop.setPlayButton(enough, player.playing);
    if (onStage) loop.setHint('');
    else if (enough) loop.setHint(`Preview of the ${finished} finished frames.`);
    else loop.setHint('The loop preview starts when two frames are finished.');
  }

  loop.onPlayToggle = () => {
    if (player.playing) player.pause();
    else player.play();
    updatePanel();
  };
  loop.onFpsChange = (fps) => player.setFps(fps);

  return {
    show() {
      loop.show(true);
      loop.hidePreview();
      updatePanel();
    },
    frameDone(frames) {
      finished = frames.count;
      player.setFrames(frames);
      // Start the small preview at two frames, unless that is already all of them.
      if (finished === 2 && finished < frameCount) {
        player.setCanvas(loop.showPreview(imageSize.width, imageSize.height));
        player.play();
      }
      updatePanel();
    },
    allDone(stageContext) {
      onStage = true;
      loop.hidePreview();
      player.setCanvas(stageContext);
      if (!player.playing) player.play();
      updatePanel();
    },
    get onStage() {
      return onStage;
    },
    redraw: () => player.redraw(),
    dispose() {
      player.dispose();
      loop.onPlayToggle = null;
      loop.onFpsChange = null;
      loop.hidePreview();
      loop.show(false);
    },
  };
}
