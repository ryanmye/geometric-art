import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/engine/rng';

describe('seeded random numbers', () => {
  it('the same keys give the same sequence; different keys a different one', () => {
    const a = createRng(1, 2, 3);
    const b = createRng(1, 2, 3);
    const c = createRng(1, 2, 4);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    const seqC = Array.from({ length: 20 }, () => c.next());
    expect(seqB).toEqual(seqA);
    expect(seqC).not.toEqual(seqA);
  });

  it('int stays in range and hits both ends; normal has mean 0 and spread 1', () => {
    const rng = createRng(42);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const v = rng.int(-2, 2);
      expect(Number.isInteger(v)).toBe(true);
      seen.add(v);
    }
    expect([...seen].sort((x, y) => x - y)).toEqual([-2, -1, 0, 1, 2]);

    let sum = 0;
    let sumSquares = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const v = rng.normal();
      sum += v;
      sumSquares += v * v;
    }
    expect(Math.abs(sum / n)).toBeLessThan(0.03);
    expect(Math.abs(Math.sqrt(sumSquares / n) - 1)).toBeLessThan(0.03);
  });
});
