// Seeded random numbers. The engine never uses Math.random: every random
// choice comes from one of these generators, so a run can be repeated exactly.

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max], both ends included. */
  int(min: number, max: number): number;
  /** Uniform float in [min, max). */
  range(min: number, max: number): number;
  /** Normally distributed float with mean 0 and standard deviation 1. */
  normal(): number;
}

/**
 * Scramble a 32-bit integer so that nearby inputs give unrelated outputs
 * (the finaliser from MurmurHash3).
 */
export function mix32(value: number): number {
  let h = value >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Create a generator from one or more integer keys, e.g.
 * createRng(seed, shapeIndex, retry, climbIndex). The same keys always give
 * the same sequence; changing any key gives an unrelated sequence.
 */
export function createRng(...keys: number[]): Rng {
  // Fold the keys into one 32-bit hash.
  let h = 0x9e3779b9;
  for (const key of keys) {
    h = mix32(h ^ mix32(key >>> 0));
    h = (h + 0x7f4a7c15) >>> 0;
  }

  // The generator itself is sfc32 (Chris Doty-Humphrey's "small fast
  // counting" generator): four 32-bit words of state, good statistical
  // quality, and only additions, shifts and xors.
  let a = mix32(h ^ 0x243f6a88);
  let b = mix32(h ^ 0x85a308d3);
  let c = mix32(h ^ 0x13198a2e);
  let d = 1;

  function nextUint32(): number {
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) >>> 0;
    return t;
  }

  // Warm up so the first outputs do not depend too directly on the keys.
  for (let i = 0; i < 12; i++) nextUint32();

  function next(): number {
    return nextUint32() / 4294967296;
  }

  return {
    next,
    int(min, max) {
      return min + Math.floor(next() * (max - min + 1));
    },
    range(min, max) {
      return min + next() * (max - min);
    },
    normal() {
      // Sum of 12 uniforms minus 6: mean 0 and variance exactly 1, and very
      // close to a true normal (only the tails beyond 6 are missing). Unlike
      // the usual Box-Muller method it needs no Math.log / Math.cos, whose
      // last digits differ between JavaScript engines, so a seed gives the
      // same shapes in every browser and in Node.
      let sum = 0;
      for (let i = 0; i < 12; i++) sum += next();
      return sum - 6;
    },
  };
}
