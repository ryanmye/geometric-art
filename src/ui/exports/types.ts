// What the export buttons need from a run, whatever engine made it. Each
// run file (src/ui/runs/) fills these in; the export code in this folder
// then works the same for every style.

/** Finished animation frames, from any engine. */
export interface FrameSource {
  /** Working-image size the frames are drawn from. */
  width: number;
  height: number;
  /** Number of finished frames. */
  count: number;
  /** Draw frame `index` filling the canvas, at `scale` output pixels per working pixel. */
  draw(ctx: CanvasRenderingContext2D, index: number, scale: number): void;
}

/** A single finished (or in-progress) picture. */
export interface PictureExports {
  /** File name without extension, e.g. "geometric-art-seed-1". */
  baseName: string;
  width: number;
  height: number;
  /** Draw the whole picture at `scale` output pixels per working pixel (used for PNG). */
  draw(ctx: CanvasRenderingContext2D, scale: number): void;
  svg(): string;
  json(): string;
}

/** An animation's finished frames. */
export interface AnimationExports {
  /** File name without extension, e.g. "geometric-art-seed-1-frames-12-shared-100". */
  baseName: string;
  frames: FrameSource;
  /** A self-contained SVG that loops by itself at `fps` frames per second. */
  animatedSVG(fps: number): string;
  json(fps: number): string;
}
