import type { RunResult } from '../engine/types';
import { drawShape } from './drawShape';

/**
 * Draw a full result (background, then every shape in order) onto a canvas
 * context at the given scale (output pixels per working-image pixel).
 * Use this for a full redraw, e.g. after a resize.
 */
export function drawResult(ctx: CanvasRenderingContext2D, result: RunResult, scale: number): void {
  const [r, g, b] = result.background;
  ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
  ctx.fillRect(0, 0, result.width * scale, result.height * scale);
  for (const record of result.shapes) {
    drawShape(ctx, record, scale);
  }
}
