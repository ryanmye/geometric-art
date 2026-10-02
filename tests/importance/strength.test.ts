import { describe, expect, it } from 'vitest';
import { DEFAULT_IMPORTANCE_STRENGTH, importanceStrength } from '../../src/importance';

describe('importance strength (shared by the page and the scripts)', () => {
  it('uses the default when none is given', () => {
    expect(importanceStrength(undefined)).toBe(DEFAULT_IMPORTANCE_STRENGTH);
    expect(importanceStrength(null)).toBe(DEFAULT_IMPORTANCE_STRENGTH);
    expect(importanceStrength('')).toBe(DEFAULT_IMPORTANCE_STRENGTH);
  });

  it('keeps 0 (unweighted), clamps to 0-1 and rounds to whole percent like the slider', () => {
    expect(importanceStrength('0')).toBe(0);
    expect(importanceStrength(0)).toBe(0);
    expect(importanceStrength('0.333')).toBe(0.33);
    expect(importanceStrength('1.7')).toBe(1);
    expect(importanceStrength('-2')).toBe(0);
    expect(importanceStrength(0.75)).toBe(0.75);
  });

  it('rejects something that is not a number', () => {
    expect(() => importanceStrength('lots')).toThrow(/must be a number/);
  });
});
