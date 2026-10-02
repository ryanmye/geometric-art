// Planning a seed animation: which seed and prefix each frame gets, and
// putting the finished frames together. Plain functions, no running.

import type {
  AnimationResult,
  AnimationSettings,
  ImportanceInfo,
  RGB,
  RunConfig,
  RunResult,
  ShapeRecord,
} from './types';

/** Seed of frame i: the base seed plus i, wrapping around at 2^32. */
export function frameSeed(baseSeed: number, frameIndex: number): number {
  return (baseSeed + frameIndex) >>> 0;
}

/** The config frame i runs with: the base config with its own seed. */
export function frameConfig(base: RunConfig, frameIndex: number): RunConfig {
  return { ...base, shapeTypes: [...base.shapeTypes], seed: frameSeed(base.seed, frameIndex) };
}

/** The shapes every frame shares: the first `shared` shapes of frame 0. */
export function sharedPrefix(frame0: RunResult, shared: number): ShapeRecord[] {
  return frame0.shapes.slice(0, shared);
}

/**
 * The prefix frame i starts from. Frame 0 starts from nothing; every other
 * frame starts from the shared shapes, so it needs frame 0 to be finished.
 */
export function framePrefix(frameIndex: number, frame0: RunResult | null, shared: number): ShapeRecord[] {
  if (frameIndex === 0) return [];
  if (!frame0) throw new Error('Frame 0 must be finished before later frames can start');
  return sharedPrefix(frame0, shared);
}

/** Throw a readable error if the animation settings cannot be used. */
export function checkAnimationSettings(settings: AnimationSettings, config: RunConfig): void {
  const { frames, shared } = settings;
  if (!Number.isInteger(frames) || frames < 1 || frames > 1000) {
    throw new Error(`Number of frames must be a whole number from 1 to 1000, got ${frames}`);
  }
  if (!Number.isInteger(shared) || shared < 0 || shared > config.maxShapes) {
    throw new Error(`Shared start must be a whole number from 0 to ${config.maxShapes} (the number of shapes), got ${shared}`);
  }
}

/** Put the finished frames together into an AnimationResult. */
export function assembleAnimation(
  picture: { width: number; height: number; background: RGB },
  config: RunConfig,
  settings: AnimationSettings,
  frames: RunResult[],
  importance?: ImportanceInfo,
): AnimationResult {
  const result: AnimationResult = {
    version: 1,
    kind: 'animation',
    width: picture.width,
    height: picture.height,
    background: [picture.background[0], picture.background[1], picture.background[2]],
    config: { ...config, shapeTypes: [...config.shapeTypes] },
    frameCount: settings.frames,
    shared: settings.shared,
    prefix: frames.length > 0 ? sharedPrefix(frames[0], settings.shared) : [],
    frames: frames.slice(),
  };
  // Only animations with weights get this field.
  if (importance) result.importance = { ...importance };
  return result;
}

/** The shapes frame i adds on top of the shared prefix. */
export function shapesAfterPrefix(animation: AnimationResult, frameIndex: number): ShapeRecord[] {
  return animation.frames[frameIndex].shapes.slice(animation.prefix.length);
}

/**
 * Read an animation JSON export back in, with a basic check that it is one.
 * (The format is AnimationResult; see types.ts.)
 */
export function parseAnimationJSON(text: string): AnimationResult {
  const data = JSON.parse(text) as AnimationResult;
  if (data?.kind !== 'animation' || data.version !== 1 || !Array.isArray(data.frames) || !Array.isArray(data.prefix)) {
    throw new Error('This is not a Geometric Art animation file');
  }
  return data;
}
