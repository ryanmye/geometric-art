import { describe, expect, it } from 'vitest';
import { applyPaintedMask } from '../../src/importance/paintedMask';
import { meanOf } from './helpers';

describe('applyPaintedMask', () => {
  it('leaves weights unchanged when nothing is painted, if their mean was already 1', () => {
    const weights = new Float32Array([0.5, 1, 1, 1.5]);
    const mask = new Uint8Array(4); // all zero
    const result = applyPaintedMask(weights, mask);
    for (let i = 0; i < result.length; i++) expect(result[i]).toBeCloseTo(weights[i], 5);
  });

  it('raises fully painted pixels relative to untouched ones', () => {
    const weights = new Float32Array([1, 1, 1, 1]);
    const mask = new Uint8Array([255, 0, 0, 0]);
    const result = applyPaintedMask(weights, mask, 4);
    expect(result[0]).toBeGreaterThan(result[1]);
    expect(result[1]).toBeCloseTo(result[2], 5);
  });

  it('keeps the mean weight at 1', () => {
    const weights = new Float32Array([0.3, 0.8, 1.2, 2.1, 0.6]);
    const mask = new Uint8Array([255, 0, 128, 0, 255]);
    const result = applyPaintedMask(weights, mask, 4);
    expect(meanOf(result)).toBeCloseTo(1, 5);
  });

  it('scales a partly painted pixel between unpainted and fully boosted', () => {
    const weights = new Float32Array([1, 1]);
    const halfMask = new Uint8Array([128, 0]);
    const fullMask = new Uint8Array([255, 0]);
    const half = applyPaintedMask(weights, halfMask, 4);
    const full = applyPaintedMask(weights, fullMask, 4);
    expect(half[0]).toBeGreaterThan(1);
    expect(half[0]).toBeLessThan(full[0]);
  });
});
