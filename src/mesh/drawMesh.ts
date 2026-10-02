// Draw a mesh on a canvas.
//
// Anti-aliasing fades the edge pixels of each triangle. Where two
// triangles meet, both fade the shared pixels partly, so a faint line of
// the background shows through ("seams"). To hide it every triangle is
// also outlined in its own colour, which spreads it by half a line width
// over its neighbours. The overlap is a fraction of a working pixel, too
// small to see.

import type { MeshResult } from './types';

/**
 * Draw `result` with its top-left corner at the canvas origin, every
 * coordinate multiplied by `scale` (output pixels per working pixel).
 */
export function drawMesh(ctx: CanvasRenderingContext2D, result: MeshResult, scale: number): void {
  const { points } = result;
  ctx.save();
  ctx.lineJoin = 'round';
  // One output pixel, but never more than half a working pixel.
  ctx.lineWidth = Math.min(1, scale / 2);
  // Polygon mesh: the same, one cell at a time.
  for (const polygon of result.polygons ?? []) {
    const [r, g, bl] = polygon.color;
    const color = `rgb(${r},${g},${bl})`;
    ctx.beginPath();
    polygon.vertices.forEach(([x, y], i) => {
      if (i === 0) ctx.moveTo(x * scale, y * scale);
      else ctx.lineTo(x * scale, y * scale);
    });
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.fill();
    ctx.stroke();
  }
  for (const triangle of result.triangles) {
    const [a, b, c] = triangle.vertices;
    const [r, g, bl] = triangle.color;
    const color = `rgb(${r},${g},${bl})`;
    ctx.beginPath();
    ctx.moveTo(points[a][0] * scale, points[a][1] * scale);
    ctx.lineTo(points[b][0] * scale, points[b][1] * scale);
    ctx.lineTo(points[c][0] * scale, points[c][1] * scale);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}
