// Public types of the mesh engine: a low-poly recreation of a photo as a
// gap-free mesh of flat-coloured triangles (the Delaunay triangulation of a
// set of points, each triangle filled with the mean colour of the photo
// pixels it covers). The optimiser moves the points so the triangles line up
// with the edges in the photo.

import type { ImportanceInfo, RGB } from '../engine/types';

export type { Bitmap, ImportanceInfo, RGB } from '../engine/types';

export interface MeshConfig {
  /** Unsigned 32-bit integer. Same target pixels + config + seed gives the same mesh. */
  seed: number;
  /**
   * Total number of points (mesh corners), including the 4 image corners and
   * the points that slide along the image border. At least 8.
   * A mesh of n points with b of them on the border has 2n - b - 2 triangles.
   */
  points: number;
  /**
   * How many points sit on the border, as a density relative to the
   * interior: 1 spaces them along the border as far apart as interior
   * points are from each other on average, 0.5 twice as far apart.
   */
  borderDensity: number;
  /**
   * Stop after this many generations. One generation is `points` attempted
   * moves (one per point on average).
   */
  generations: number;
  /**
   * 0–1: share of moves that pick up a random point and drop it inside one
   * of the worst-matching triangles, instead of nudging it a little.
   */
  jumpRate: number;
  /**
   * How far a move may make the mesh worse and still be kept, at the start
   * of the run, as a share of the average triangle's squared error. Shrinks
   * to 0 by the last generation. 0 keeps only improving moves (plain hill
   * climbing). Letting the mesh get a little worse early on helps it out of
   * poor arrangements.
   */
  tolerance: number;
  /**
   * What the picture is made of. 'triangles' (the default when absent): the
   * Delaunay triangles of the points. 'polygons': each point's Voronoi cell
   * (the pixels nearer to it than to any other point), giving a mosaic of
   * convex polygons; see cells.ts. Absent in configs from before polygons
   * existed, which therefore still produce exactly the same output.
   */
  cells?: 'triangles' | 'polygons';
}

/** One cell of a polygon mesh (config.cells = 'polygons'). */
export interface MeshPolygon {
  /** Index into MeshResult.points of the point whose cell this is. */
  site: number;
  /**
   * Corners in image coordinates (not point indices), clockwise on screen,
   * rounded to 0.01 px. The cell clipped to the image; cells tile the image.
   */
  vertices: Array<[number, number]>;
  /** Mean colour of the target pixels whose centre is nearest this site. */
  color: RGB;
}

/** One triangle of the mesh. */
export interface MeshTriangle {
  /** Indices into MeshResult.points, in clockwise order on screen (y down). */
  vertices: [number, number, number];
  /** Flat fill colour: the mean colour of the target pixels the triangle covers. */
  color: RGB;
}

/**
 * The finished (or in-progress) mesh. This is also the JSON export format.
 *
 * Coordinates are in working-image pixels: the image spans [0, width] x
 * [0, height], x to the right, y down. Every point has integer coordinates.
 * The triangles cover that rectangle exactly once with no gaps: points 0–3
 * are the corners (0,0), (width,0), (width,height), (0,height), and the
 * points with an x of 0 or width, or a y of 0 or height, lie on the border.
 * To draw at another size, multiply every coordinate by outputWidth / width.
 *
 * A pixel belongs to the triangle that contains its centre (px + 0.5,
 * py + 0.5); a centre exactly on an edge goes to the triangle on its right
 * (larger x). See rasterize.ts.
 */
export interface MeshResult {
  version: 1;
  kind: 'mesh';
  /** Working-image size that all coordinates refer to. */
  width: number;
  height: number;
  config: MeshConfig;
  /** Point coordinates [x, y]. */
  points: Array<[number, number]>;
  /** Sorted by their vertex indices, so the same mesh always gives the same JSON. */
  triangles: MeshTriangle[];
  /**
   * Error of the drawn mesh: root-mean-square difference between it and the
   * target over the R, G and B channels, divided by 255. 0 is a perfect match.
   * Same units as RunResult.score of the shape engine.
   */
  score: number;
  /** Generations completed so far (equals config.generations when done). */
  generation: number;
  /**
   * Present only for polygon meshes (config.cells = 'polygons'): one cell per
   * point, in point order. For those, `points` holds the cell sites and
   * `triangles` is empty, so readers that only know triangles draw nothing
   * rather than something wrong. A pixel belongs to the cell whose site is
   * nearest its centre (ties: the lower point index), see cells.ts.
   */
  polygons?: MeshPolygon[];
  /** Present only when the run used per-pixel weights: what produced them (the weights are not stored). */
  importance?: ImportanceInfo;
  /**
   * Present only when the run used per-pixel weights: the same error with
   * each pixel counted by its weight, which is what the optimiser minimised.
   */
  weightedScore?: number;
}

export type MeshRunnerState = 'idle' | 'running' | 'paused' | 'done';

export interface MeshRunnerEvents {
  /**
   * The current mesh, sent at most every MeshRunnerOptions.progressInterval
   * milliseconds while running (and once on pause).
   */
  onProgress?(result: MeshResult, generation: number): void;
  /** Called once, after the last generation. */
  onDone?(result: MeshResult): void;
  onError?(error: Error): void;
}

export interface MeshRunnerOptions {
  /**
   * 'worker' runs the whole optimisation in one web worker (browser).
   * 'inline' runs it on the calling thread in short slices (tests, Node).
   * Default: 'worker' when Worker exists, otherwise 'inline'.
   * Never changes the result.
   */
  executor?: 'worker' | 'inline';
  /** Minimum time between onProgress calls, in milliseconds. Default 100. */
  progressInterval?: number;
  /**
   * Optional weight per pixel (row-major, mean about 1, e.g. from
   * computeImportance): errors at heavier pixels count more, and the
   * starting points and jumps favour them. Fill colours stay the plain mean
   * and `score` stays unweighted. Converted once to whole numbers (weights.ts).
   */
  weights?: ArrayLike<number>;
  /** How the weights were made; copied into the results. */
  importance?: ImportanceInfo;
}

export interface MeshRunner {
  readonly state: MeshRunnerState;
  /** Start, or resume after pause(). */
  start(): void;
  /** Stop soon (within a few tens of milliseconds); start() resumes exactly where it stopped. */
  pause(): void;
  /**
   * Snapshot of the mesh so far. Inline: always current. Worker: the latest
   * mesh the worker sent (progress, pause or done).
   */
  result(): MeshResult;
  /** Stop and release the worker. The runner cannot be used afterwards. */
  dispose(): void;
}

// ---- Seed animation ----
//
// The same photo as a mesh under several seeds, played as a loop so it
// "boils". Frame i uses seed (config.seed + i); frame 0 is exactly the single
// run for config.seed. See animationPlan.ts for how `variation` works.

export interface MeshAnimationSettings {
  /** Number of frames, 1 to 1000. */
  frames: number;
  /**
   * 0 to 1: how much frames differ from frame 0. 1: every frame is an
   * independent run with its own seed. Lower: frames start from frame 0's
   * points with that share of them re-seeded, and are re-optimised for that
   * share of the generations, so the mesh only shimmers. 0: all frames equal.
   */
  variation: number;
}

/**
 * A finished (or in-progress) mesh animation. This is also the animation
 * JSON export format: the settings and every finished frame as a complete
 * MeshResult (each can be drawn or exported on its own).
 */
export interface MeshAnimationResult {
  version: 1;
  kind: 'mesh-animation';
  /** Working-image size, as in MeshResult. */
  width: number;
  height: number;
  /** Config of frame 0. Frame i's own config (seed, schedule) is in frames[i].config. */
  config: MeshConfig;
  /** Frames requested (`frames.length` is less until the animation is done). */
  frameCount: number;
  variation: number;
  /** Finished frames in order. */
  frames: MeshResult[];
  /** Playback speed chosen on the page when exported. Not used by the engine. */
  fps?: number;
  /** Present only when the frames used per-pixel weights (the same weights for every frame). */
  importance?: ImportanceInfo;
}

export interface MeshAnimationEvents {
  /** A frame starts; `seed` is the seed it uses. */
  onFrameStart?(frameIndex: number, seed: number): void;
  /** The frame being built, as in MeshRunnerEvents.onProgress. */
  onProgress?(frame: MeshResult, generation: number, frameIndex: number): void;
  onFrameDone?(frame: MeshResult, frameIndex: number): void;
  /** Called once, when every frame is finished. */
  onDone?(result: MeshAnimationResult): void;
  onError?(error: Error): void;
}

export interface MeshAnimationRunner {
  readonly state: MeshRunnerState;
  /** Index of the frame being built (equals the frame count once done). */
  readonly frameIndex: number;
  /** Start, or resume after pause(). */
  start(): void;
  /** Stop soon; start() resumes exactly where it stopped. */
  pause(): void;
  /** Snapshot of the finished frames. */
  result(): MeshAnimationResult;
  /**
   * The latest snapshot of the frame being built: null between frames, from
   * the start of a frame until its first progress report, and when done. So
   * it never returns a frame other than the one being built.
   */
  currentFrame(): MeshResult | null;
  /** Stop and release the worker. */
  dispose(): void;
}
