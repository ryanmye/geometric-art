// Planning a mesh seed animation: the config and starting points of each
// frame, and putting the finished frames together. Plain functions, no
// running.
//
// Frame i uses seed (base seed + i). Frame 0 is exactly the single mesh run
// for the base seed. `variation` (0 to 1) sets how much the other frames
// differ from it:
//   - each later frame starts from frame 0's finished points, except that a
//     share of them (picked at random, see replacedShare) are replaced by
//     where that point starts in an independent run with the frame's own seed;
//   - it is then optimised with the frame's seed for variation x the
//     generations, with the tolerance scaled by variation^2 (a shorter,
//     cooler schedule), so the replaced points settle in and the rest only
//     shift a little.
// At 1 every point is replaced and the schedule is the full one, so each
// frame is exactly an independent run with its own seed. At 0 every frame
// is a copy of frame 0.

import type { Bitmap } from '../engine/types';
import { createRng } from '../engine/rng';
import { borderPoint, borderPosition, isCornerPosition, perimeter } from './border';
import { initialPoints, type PointLayout } from './initialPoints';
import type { MeshAnimationResult, MeshAnimationSettings, MeshConfig, MeshResult } from './types';

/** Seed of frame i: the base seed plus i, wrapping around at 2^32. */
export function frameSeed(baseSeed: number, frameIndex: number): number {
  return (baseSeed + frameIndex) >>> 0;
}

/** The config frame i runs with. Frame 0 (and every frame at variation 1) runs the base config with its own seed. */
export function frameConfig(base: MeshConfig, frameIndex: number, variation: number): MeshConfig {
  const seed = frameSeed(base.seed, frameIndex);
  if (frameIndex === 0 || variation >= 1) return { ...base, seed };
  if (variation <= 0) return { ...base, seed, generations: 0, tolerance: 0 };
  return {
    ...base,
    seed,
    generations: Math.max(1, Math.round(variation * base.generations)),
    tolerance: base.tolerance * variation * variation,
  };
}

/**
 * Share of frame 0's points a frame replaces, by variation. How much a frame
 * visibly differs from frame 0 levels off once about a third of the points
 * are replaced (measured on the Mona Lisa, 300 points: share of pixels whose
 * colour changes noticeably), so the share rises slowly at first and steeply
 * at the end, which makes the visible change grow roughly evenly with
 * variation. Straight lines between these (variation, share) pairs:
 */
const SHARE_TABLE: Array<[number, number]> = [
  [0, 0],
  [0.1, 0.01],
  [0.3, 0.045],
  [0.5, 0.09],
  [0.7, 0.15],
  [0.9, 0.3],
  [1, 1],
];

export function replacedShare(variation: number): number {
  if (variation <= 0) return 0;
  if (variation >= 1) return 1;
  for (let i = 1; i < SHARE_TABLE.length; i++) {
    const [v1, s1] = SHARE_TABLE[i];
    if (variation <= v1) {
      const [v0, s0] = SHARE_TABLE[i - 1];
      return s0 + ((variation - v0) * (s1 - s0)) / (v1 - v0);
    }
  }
  return 1;
}

/**
 * Starting points of frame i (i >= 1, 0 < variation): frame 0's finished
 * points, with replacedShare(variation) of them swapped for the frame's own
 * fresh starting points. Same order and kinds of points as any layout.
 */
export function frameLayout(
  target: Bitmap,
  base: MeshConfig,
  frameIndex: number,
  variation: number,
  frame0: MeshResult,
  weights: Uint16Array | null,
): PointLayout {
  const { width, height } = target;
  const seed = frameSeed(base.seed, frameIndex);
  // The very layout an independent run with this seed starts from.
  const fresh = initialPoints(target, base.points, base.borderDensity, createRng(seed, 0), weights);
  const pick = createRng(seed, 2); // its own generator, so the moves' generator is untouched
  const share = replacedShare(variation);
  const xs = new Int32Array(base.points);
  const ys = new Int32Array(base.points);
  const taken = new Uint8Array((width + 1) * (height + 1));
  const isFree = (x: number, y: number) => !taken[y * (width + 1) + x];
  const place = (p: number, x: number, y: number) => {
    xs[p] = x;
    ys[p] = y;
    taken[y * (width + 1) + x] = 1;
  };

  for (let p = 0; p < base.points; p++) {
    const [oldX, oldY] = frame0.points[p];
    if (p < 4) {
      place(p, oldX, oldY);
      continue;
    }
    const useFresh = pick.next() < share;
    const firstX = useFresh ? fresh.xs[p] : oldX;
    const firstY = useFresh ? fresh.ys[p] : oldY;
    const otherX = useFresh ? oldX : fresh.xs[p];
    const otherY = useFresh ? oldY : fresh.ys[p];
    if (isFree(firstX, firstY)) place(p, firstX, firstY);
    else if (isFree(otherX, otherY)) place(p, otherX, otherY);
    else if (p < fresh.interiorStart) placeNearOnBorder(p, firstX, firstY);
    else placeNearInside(p, firstX, firstY);
  }
  return { xs, ys, borderStart: 4, interiorStart: fresh.interiorStart };

  // Both wanted spots are taken (rare): the nearest free spot of the same kind.
  function placeNearOnBorder(p: number, x: number, y: number): void {
    const loop = perimeter(width, height);
    const s = borderPosition(x, y, width, height);
    const spot = new Int32Array(2);
    for (let step = 1; step < loop; step++) {
      for (const candidate of [s + step, s - step]) {
        const position = ((candidate % loop) + loop) % loop;
        if (isCornerPosition(position, width, height)) continue;
        borderPoint(position, width, height, spot);
        if (isFree(spot[0], spot[1])) return place(p, spot[0], spot[1]);
      }
    }
  }

  function placeNearInside(p: number, x: number, y: number): void {
    for (let radius = 1; radius < width + height; radius++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue; // only the ring
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 1 && nx <= width - 1 && ny >= 1 && ny <= height - 1 && isFree(nx, ny)) return place(p, nx, ny);
        }
      }
    }
  }
}

/** Frame i at variation 0: frame 0's mesh, labelled with the frame's own config. */
export function copyOfFrame0(frame0: MeshResult, config: MeshConfig): MeshResult {
  const copy = JSON.parse(JSON.stringify(frame0)) as MeshResult;
  copy.config = { ...config };
  copy.generation = 0;
  return copy;
}

/** Throw a readable error if the animation settings cannot be used. */
export function checkMeshAnimationSettings(settings: MeshAnimationSettings): void {
  const { frames, variation } = settings;
  if (!Number.isInteger(frames) || frames < 1 || frames > 1000) {
    throw new Error(`Number of frames must be a whole number from 1 to 1000, got ${frames}`);
  }
  if (!(variation >= 0 && variation <= 1)) throw new Error(`variation must be from 0 to 1, got ${variation}`);
}

/** Put the finished frames together into a MeshAnimationResult. */
export function assembleMeshAnimation(
  size: { width: number; height: number },
  config: MeshConfig,
  settings: MeshAnimationSettings,
  frames: MeshResult[],
): MeshAnimationResult {
  const result: MeshAnimationResult = {
    version: 1,
    kind: 'mesh-animation',
    width: size.width,
    height: size.height,
    config: { ...config },
    frameCount: settings.frames,
    variation: settings.variation,
    frames: frames.slice(),
  };
  if (frames.length > 0 && frames[0].importance) result.importance = { ...frames[0].importance };
  return result;
}

/** Read a mesh animation JSON export back in, with a basic check that it is one. */
export function parseMeshAnimationJSON(text: string): MeshAnimationResult {
  const data = JSON.parse(text) as MeshAnimationResult;
  if (data?.kind !== 'mesh-animation' || data.version !== 1 || !Array.isArray(data.frames)) {
    throw new Error('This is not a Geometric Art mesh animation file');
  }
  for (const frame of data.frames) checkMeshShape(frame);
  return data;
}

/** Read a single mesh JSON export back in, with a basic check that it is one. */
export function parseMeshJSON(text: string): MeshResult {
  const data = JSON.parse(text) as MeshResult;
  checkMeshShape(data);
  return data;
}

function checkMeshShape(data: MeshResult): void {
  if (data?.kind !== 'mesh' || data.version !== 1 || !Array.isArray(data.points) || !Array.isArray(data.triangles)) {
    throw new Error('This is not a Geometric Art mesh file');
  }
}
