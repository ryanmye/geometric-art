// Turn the optimiser's state into a MeshResult (the export format).

import type { RGB } from '../engine/types';
import type { MeshState } from './state';
import { measureTriangle } from './triangleScore';
import type { MeshPolygon, MeshResult, MeshTriangle } from './types';
import { readTotals } from './cells';
import { cellOutline } from './voronoiPolygons';

export function meshResult(state: MeshState): MeshResult {
  if (state.cells) return polygonResult(state);
  const { tri, xs, ys, width, height } = state;
  const points: Array<[number, number]> = [];
  for (let p = 0; p < xs.length; p++) points.push([xs[p], ys[p]]);

  const triangles: MeshTriangle[] = [];
  // Exact squared error of the drawn mesh, with colours rounded to whole
  // numbers, plain and (in a weighted run) weighted.
  let squaredError = 0;
  let weightedError = 0;
  let weightTotal = 0;
  for (let t = 0; t < tri.capacity; t++) {
    if (!tri.alive[t]) continue;
    let a = tri.corners[3 * t], b = tri.corners[3 * t + 1], c = tri.corners[3 * t + 2];
    // Start each triangle at its smallest point number (same turning order).
    if (b < a && b < c) [a, b, c] = [b, c, a];
    else if (c < a && c < b) [a, b, c] = [c, a, b];

    const totals = measureTriangle(state.scorer, xs[a], ys[a], xs[b], ys[b], xs[c], ys[c]);
    let color: RGB;
    if (totals.count > 0) {
      color = [
        Math.round(totals.red / totals.count),
        Math.round(totals.green / totals.count),
        Math.round(totals.blue / totals.count),
      ];
      // sum of |pixel - color|^2 = squares - 2 color.sum + count |color|^2, all whole numbers.
      squaredError +=
        totals.squares -
        2 * (color[0] * totals.red + color[1] * totals.green + color[2] * totals.blue) +
        totals.count * (color[0] * color[0] + color[1] * color[1] + color[2] * color[2]);
      if (state.weights) {
        weightedError +=
          totals.wSquares -
          2 * (color[0] * totals.wRed + color[1] * totals.wGreen + color[2] * totals.wBlue) +
          totals.weight * (color[0] * color[0] + color[1] * color[1] + color[2] * color[2]);
        weightTotal += totals.weight;
      }
    } else {
      // A sliver between pixel centres: use the pixel under its centre.
      color = pixelAt(state, (xs[a] + xs[b] + xs[c]) / 3, (ys[a] + ys[b] + ys[c]) / 3);
    }
    triangles.push({ vertices: [a, b, c], color });
  }
  triangles.sort(compareTriangles);

  const result: MeshResult = {
    version: 1,
    kind: 'mesh',
    width,
    height,
    config: { ...state.config },
    points,
    triangles,
    score: Math.sqrt(squaredError / (3 * width * height)) / 255,
    generation: state.generation,
  };
  // Only weighted runs get these fields, so unweighted results are unchanged.
  if (state.weights) {
    result.importance = { ...state.importance };
    result.weightedScore = Math.sqrt(weightedError / (3 * weightTotal)) / 255;
  }
  return result;
}

function compareTriangles(p: MeshTriangle, q: MeshTriangle): number {
  return (
    p.vertices[0] - q.vertices[0] ||
    p.vertices[1] - q.vertices[1] ||
    p.vertices[2] - q.vertices[2]
  );
}

/** Colour of the target pixel containing (x, y), using the row sums. */
function pixelAt(state: MeshState, x: number, y: number): RGB {
  const { sums, width, height } = state;
  const px = Math.min(width - 1, Math.max(0, Math.floor(x)));
  const py = Math.min(height - 1, Math.max(0, Math.floor(y)));
  const i = py * (width + 1) + px;
  return [sums.red[i + 1] - sums.red[i], sums.green[i + 1] - sums.green[i], sums.blue[i + 1] - sums.blue[i]];
}

/**
 * A polygon mesh: `points` are the cell sites, `triangles` is empty and
 * `polygons` holds one cell per point (see MeshResult in types.ts).
 */
function polygonResult(state: MeshState): MeshResult {
  const { tri, xs, ys, width, height } = state;
  const cells = state.cells!;
  const points: Array<[number, number]> = [];
  for (let p = 0; p < xs.length; p++) points.push([xs[p], ys[p]]);

  const polygons: MeshPolygon[] = [];
  let squaredError = 0;
  let weightedError = 0;
  let weightTotal = 0;
  for (let p = 0; p < xs.length; p++) {
    const totals = readTotals(cells, p);
    let color: RGB;
    if (totals.count > 0) {
      color = [
        Math.round(totals.red / totals.count),
        Math.round(totals.green / totals.count),
        Math.round(totals.blue / totals.count),
      ];
      // As for triangles: exact whole-number error of the drawn colour.
      squaredError +=
        totals.squares -
        2 * (color[0] * totals.red + color[1] * totals.green + color[2] * totals.blue) +
        totals.count * (color[0] * color[0] + color[1] * color[1] + color[2] * color[2]);
      if (state.weights) {
        weightedError +=
          totals.wSquares -
          2 * (color[0] * totals.wRed + color[1] * totals.wGreen + color[2] * totals.wBlue) +
          totals.weight * (color[0] * color[0] + color[1] * color[1] + color[2] * color[2]);
        weightTotal += totals.weight;
      }
    } else {
      // A cell too small to hold a pixel centre: the pixel under its site.
      color = pixelAt(state, xs[p], ys[p]);
    }
    polygons.push({ site: p, vertices: cellOutline(tri, p, width, height), color });
  }

  const result: MeshResult = {
    version: 1,
    kind: 'mesh',
    width,
    height,
    config: { ...state.config },
    points,
    triangles: [],
    score: Math.sqrt(squaredError / (3 * width * height)) / 255,
    generation: state.generation,
    polygons,
  };
  if (state.weights) {
    result.importance = { ...state.importance };
    result.weightedScore = Math.sqrt(weightedError / (3 * weightTotal)) / 255;
  }
  return result;
}
