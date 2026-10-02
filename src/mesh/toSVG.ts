// A mesh as a standalone SVG document.
//
// Each triangle is a <polygon> filled with its colour and outlined in the
// same colour (stroke-width 0.5 working pixels). The outline covers the
// faint "seams" that anti-aliasing would otherwise leave between
// neighbouring triangles; see drawMesh.ts. The viewBox is the working
// image, so the SVG scales to any size. Polygon meshes are written the same
// way, one <polygon> per cell, corners to 0.01 px as stored in the result.

import type { RGB } from '../engine/types';
import type { MeshPolygon, MeshResult, MeshTriangle } from './types';

export function meshToSVG(result: MeshResult): string {
  const { width, height, points } = result;
  const lines: string[] = [];
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
  );
  lines.push('<g stroke-width="0.5" stroke-linejoin="round">');
  for (const triangle of result.triangles) lines.push(polygonTag(points, triangle));
  for (const polygon of result.polygons ?? []) lines.push(cellTag(polygon));
  lines.push('</g>');
  lines.push('</svg>');
  return lines.join('\n');
}

/** One triangle as a <polygon>, filled and outlined in its colour. */
export function polygonTag(points: Array<[number, number]>, triangle: MeshTriangle): string {
  const [a, b, c] = triangle.vertices;
  const color = hex(triangle.color);
  return (
    `<polygon points="${points[a][0]},${points[a][1]} ${points[b][0]},${points[b][1]} ${points[c][0]},${points[c][1]}" ` +
    `fill="${color}" stroke="${color}"/>`
  );
}

/** One cell of a polygon mesh as a <polygon>, filled and outlined in its colour. */
export function cellTag(polygon: MeshPolygon): string {
  const color = hex(polygon.color);
  const corners = polygon.vertices.map(([x, y]) => `${x},${y}`).join(' ');
  return `<polygon points="${corners}" fill="${color}" stroke="${color}"/>`;
}

function hex([r, g, b]: RGB): string {
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}
