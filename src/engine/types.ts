// Shared contract between the engine (src/engine, src/worker) and the page
// (src/ui, src/render). Both sides are written against this file.

/** An RGBA image. Structurally compatible with the browser's ImageData. */
export interface Bitmap {
  width: number;
  height: number;
  /** RGBA bytes, row-major, length = width * height * 4. */
  data: Uint8ClampedArray;
}

/** Red, green, blue, each an integer 0–255. */
export type RGB = [number, number, number];

export type ShapeType =
  | 'triangle'
  | 'rectangle'
  | 'rotatedRectangle'
  | 'ellipse'
  | 'rotatedEllipse';

export const SHAPE_TYPES: readonly ShapeType[] = [
  'triangle',
  'rectangle',
  'rotatedRectangle',
  'ellipse',
  'rotatedEllipse',
];

// Coordinates are in working-image pixels: the image spans [0, width] x
// [0, height], x to the right, y down, and pixel (px, py) covers the square
// [px, px+1) x [py, py+1). The search rasterizer treats a pixel as covered
// when its centre (px + 0.5, py + 0.5) is inside the shape. To draw at
// another size, scale every coordinate by outputWidth / width.
//
// Angles are in degrees, clockwise on screen (the same direction as SVG's
// rotate() and canvas rotate()), about the shape's centre.
export type Shape =
  | { type: 'triangle'; x1: number; y1: number; x2: number; y2: number; x3: number; y3: number }
  | { type: 'rectangle'; x1: number; y1: number; x2: number; y2: number } // x1 < x2, y1 < y2
  | { type: 'rotatedRectangle'; cx: number; cy: number; w: number; h: number; angle: number } // w, h are full side lengths
  | { type: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
  | { type: 'rotatedEllipse'; cx: number; cy: number; rx: number; ry: number; angle: number };

/** One accepted shape, in the order it was painted. */
export interface ShapeRecord {
  shape: Shape;
  color: RGB;
  /** Opacity as an integer 1–255. Painted with ordinary source-over blending. */
  alpha: number;
  /** Error of the whole picture after this shape was added (see RunResult.score). */
  score: number;
}

export interface RunConfig {
  /** Unsigned 32-bit integer. Same target + config + seed gives the same shapes. */
  seed: number;
  /** Shape types to draw from. With more than one, each candidate picks one at random. */
  shapeTypes: ShapeType[];
  /** Opacity of every shape, integer 1–255. */
  alpha: number;
  /** Stop after this many shapes (counting any prefix shapes). */
  maxShapes: number;
  /** Independent searches per shape; the best one wins. */
  climbs: number;
  /** Random shapes tried at the start of each search before hill climbing. */
  candidates: number;
  /** A hill climb ends after this many mutations in a row fail to improve. */
  maxAge: number;
  /** 0–1: share of random candidates placed where the picture is currently worst. */
  errorBias: number;
}

/** The finished (or in-progress) picture. This is also the JSON export format. */
export interface RunResult {
  version: 1;
  /** Working-image size that all shape coordinates refer to. */
  width: number;
  height: number;
  /** Solid colour the canvas starts as (the average colour of the target). */
  background: RGB;
  config: RunConfig;
  shapes: ShapeRecord[];
  /**
   * Current error: root-mean-square difference between picture and target over
   * the R, G and B channels, divided by 255. 0 is a perfect match.
   * Always unweighted, so runs with and without weights can be compared.
   */
  score: number;
  /**
   * Present only when the run used per-pixel weights: what produced them.
   * (Weights themselves are not stored.)
   */
  importance?: ImportanceInfo;
  /**
   * Present only when the run used per-pixel weights: the same error with each
   * pixel counted by its weight, which is what the search minimised.
   */
  weightedScore?: number;
}

/** How a run's per-pixel weights were made, recorded in its results. */
export interface ImportanceInfo {
  /** Strength of "focus detail on edges and features", 0 to 1. */
  strength?: number;
  /** Whether a painted "detail here" mask was applied on top. */
  painted?: boolean;
}

export type RunnerState = 'idle' | 'running' | 'paused' | 'done';

export interface RunnerEvents {
  /** Called on the calling thread each time a shape is accepted. index is its position in RunResult.shapes. */
  onShape?(record: ShapeRecord, index: number): void;
  /**
   * Called once when maxShapes is reached, or earlier if no shape can lower
   * the error any more (25 failed attempts in a row, or a perfect match).
   */
  onDone?(result: RunResult): void;
  onError?(error: Error): void;
}

export interface RunnerOptions {
  /**
   * Shapes to paint before searching starts (used to give several seeds a
   * common beginning). They count toward maxShapes and are not reported
   * through onShape.
   */
  prefix?: ShapeRecord[];
  /**
   * 'workers' runs the searches in a pool of web workers (browser).
   * 'inline' runs them on the calling thread (tests, Node scripts).
   * Default: 'workers' when Worker exists, otherwise 'inline'.
   */
  executor?: 'workers' | 'inline';
  /**
   * Optional weight per pixel (row-major, mean about 1, e.g. from
   * computeImportance): errors at heavier pixels count more in the search.
   * Converted once to whole numbers (see src/engine/weights.ts).
   */
  weights?: ArrayLike<number>;
  /** How the weights were made; copied into the results. */
  importance?: ImportanceInfo;
  /**
   * Pool size for 'workers'. Default: navigator.hardwareConcurrency. For
   * 'inline' it splits the climbs between that many simulated workers
   * (default 1), which tests use. Never changes the output.
   */
  workerCount?: number;
}

export interface Runner {
  readonly state: RunnerState;
  /** Start, or resume after pause(). */
  start(): void;
  /** Stop after the shape currently being searched for. */
  pause(): void;
  /** Snapshot of the picture so far. Safe to call at any time. */
  result(): RunResult;
  /** Stop and release the workers. The runner cannot be used afterwards. */
  dispose(): void;
}

// ---- Seed animation ----
//
// The same photo recreated under several seeds and played as a loop. Frame i
// uses seed (config.seed + i). Frame 0 is an ordinary run; every later frame
// starts from frame 0's first `shared` shapes (as its prefix) and continues
// with its own seed, so those shapes hold still while the rest "boils".

export interface AnimationSettings {
  /** Number of frames, at least 1. */
  frames: number;
  /** How many of frame 0's first shapes every frame shares (0 to maxShapes). */
  shared: number;
}

/**
 * A finished (or in-progress) animation. This is also the animation JSON
 * export format: the settings, the shared shapes once in `prefix`, and every
 * finished frame as a complete RunResult (whose shapes begin with `prefix`,
 * so each frame can be drawn or exported on its own).
 */
export interface AnimationResult {
  version: 1;
  kind: 'animation';
  /** Working-image size, as in RunResult. */
  width: number;
  height: number;
  background: RGB;
  /** Settings of frame 0; frame i used the same with seed config.seed + i (wrapping at 2^32). */
  config: RunConfig;
  /** Frames requested (`frames.length` is less until the animation is done). */
  frameCount: number;
  /** Shared start requested. */
  shared: number;
  /** The shapes common to every frame: frame 0's first `shared` shapes (empty until frame 0 is done). */
  prefix: ShapeRecord[];
  /** Finished frames in order. */
  frames: RunResult[];
  /** Playback speed in frames per second chosen on the page when exported. Not used by the engine. */
  fps?: number;
  /** Present only when the frames used per-pixel weights (the same weights for every frame). */
  importance?: ImportanceInfo;
}

export interface AnimationEvents {
  /** A frame starts; `seed` is the seed it uses. */
  onFrameStart?(frameIndex: number, seed: number): void;
  /** A shape was accepted in the frame being built (index as in RunnerEvents.onShape). */
  onShape?(record: ShapeRecord, index: number, frameIndex: number): void;
  onFrameDone?(frame: RunResult, frameIndex: number): void;
  /** Called once, when every frame is finished. */
  onDone?(result: AnimationResult): void;
  onError?(error: Error): void;
}

export interface AnimationRunner {
  readonly state: RunnerState;
  /** Index of the frame being built (equals the frame count once done). */
  readonly frameIndex: number;
  /** Start, or resume after pause(). */
  start(): void;
  /** Stop after the shape currently being searched for. */
  pause(): void;
  /** Snapshot of the finished frames. */
  result(): AnimationResult;
  /** Snapshot of the frame being built, or null between frames and when done. */
  currentFrame(): RunResult | null;
  /** Stop and release the workers. */
  dispose(): void;
}
