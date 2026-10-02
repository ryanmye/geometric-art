// Draw a mesh into a Bitmap at working size, pixel by pixel, with exactly
// the pixel rule the optimiser scores with (rasterize.ts for triangles,
// cells.ts for polygons). Used by the command-line script and the tests;
// the page draws with drawMesh instead.

import type { Bitmap } from '../engine/types';
import { cellOwners } from './cellOwners';
import { triangleSpans } from './rasterize';
import type { MeshResult } from './types';

export function rasterizeMesh(result: MeshResult): Bitmap {
  const { width, height, points } = result;
  const data = new Uint8ClampedArray(width * height * 4);
  if (result.polygons) {
    // Polygon mesh: each pixel takes the colour of the cell whose site is nearest.
    const colors = new Array<[number, number, number]>(points.length);
    for (const polygon of result.polygons) colors[polygon.site] = polygon.color;
    const owner = cellOwners(points, width, height);
    for (let i = 0; i < width * height; i++) {
      const color = colors[owner[i]];
      data[4 * i] = color[0];
      data[4 * i + 1] = color[1];
      data[4 * i + 2] = color[2];
      data[4 * i + 3] = 255;
    }
    return { width, height, data };
  }
  const runs = new Int32Array(3 * height);
  for (const triangle of result.triangles) {
    const [a, b, c] = triangle.vertices;
    const [r, g, bl] = triangle.color;
    const count = triangleSpans(
      points[a][0], points[a][1], points[b][0], points[b][1], points[c][0], points[c][1],
      width, height, runs,
    );
    for (let i = 0; i < count; i++) {
      const row = runs[3 * i];
      for (let x = runs[3 * i + 1]; x <= runs[3 * i + 2]; x++) {
        const p = 4 * (row * width + x);
        data[p] = r;
        data[p + 1] = g;
        data[p + 2] = bl;
        data[p + 3] = 255;
      }
    }
  }
  return { width, height, data };
}
