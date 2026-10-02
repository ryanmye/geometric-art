import { describe, expect, it } from 'vitest';
import { fitMeshPoints, pointsNote } from '../../src/ui/runs/fitPoints';
import { DEFAULT_MESH_CONFIG, MESH_POLYGON_DEFAULTS, checkMeshConfig, maxMeshPoints } from '../../src/mesh';

const blank = (width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) });

describe('fitting the mesh point count to the picture', () => {
  it('leaves a count the picture can hold untouched (the same config object)', () => {
    const fitted = fitMeshPoints(DEFAULT_MESH_CONFIG, 172, 256);
    expect(fitted.config).toBe(DEFAULT_MESH_CONFIG);
    expect(fitted.reduced).toBe(false);
    expect(pointsNote(fitted)).toBeNull();
  });

  it('uses the most a small picture can hold, which the mesh engine then accepts', () => {
    // 2000 x 20 at working size 128 is 128 x 2: room for 129 * 3 = 387 points.
    const fitted = fitMeshPoints(MESH_POLYGON_DEFAULTS, 128, 2);
    expect(maxMeshPoints(128, 2)).toBe(387);
    expect(fitted.config).toEqual({ ...MESH_POLYGON_DEFAULTS, points: 387 });
    expect(fitted.reduced).toBe(true);
    expect(pointsNote(fitted)).toBe('This picture can hold at most 387 points, so 387 were used instead of 600.');
    expect(() => checkMeshConfig(blank(128, 2), fitted.config)).not.toThrow();
    // The engine itself stays strict.
    expect(() => checkMeshConfig(blank(128, 2), MESH_POLYGON_DEFAULTS)).toThrow(/points must be a whole number from 8 to 387/);
    // 5000 typed points on a 16 x 16 picture: 17 * 17 = 289.
    expect(fitMeshPoints({ ...DEFAULT_MESH_CONFIG, points: 5000 }, 16, 16).config.points).toBe(289);
  });

  it('gives a clear message when the picture cannot hold even the fewest points', () => {
    expect(() => fitMeshPoints(DEFAULT_MESH_CONFIG, 2, 1)).toThrow(/too small for a mesh/);
    expect(fitMeshPoints(DEFAULT_MESH_CONFIG, 2, 2).config.points).toBe(9);
  });
});
