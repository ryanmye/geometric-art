import type { Shape, ShapeRecord } from '../engine/types';

/**
 * Build the CSS color string for a shape record's fill, including its alpha
 * (stored as 1-255 in the contract, so we convert to 0-1 for canvas/CSS).
 */
export function fillStyle(color: ShapeRecord['color'], alpha: ShapeRecord['alpha']): string {
  const [r, g, b] = color;
  return `rgba(${r}, ${g}, ${b}, ${alpha / 255})`;
}

/**
 * Trace a shape's outline into a 2D context, in working-image coordinates
 * scaled by `scale` (output pixels per working-image pixel). Does not fill
 * or set styles, so the caller can fill, stroke, or just measure.
 */
function tracePath(ctx: CanvasRenderingContext2D, shape: Shape, scale: number): void {
  ctx.beginPath();
  switch (shape.type) {
    case 'triangle':
      ctx.moveTo(shape.x1 * scale, shape.y1 * scale);
      ctx.lineTo(shape.x2 * scale, shape.y2 * scale);
      ctx.lineTo(shape.x3 * scale, shape.y3 * scale);
      ctx.closePath();
      break;
    case 'rectangle':
      ctx.rect(
        shape.x1 * scale,
        shape.y1 * scale,
        (shape.x2 - shape.x1) * scale,
        (shape.y2 - shape.y1) * scale,
      );
      break;
    case 'rotatedRectangle': {
      // Rotate about the centre: translate there, rotate, draw centred rect, undo.
      ctx.save();
      ctx.translate(shape.cx * scale, shape.cy * scale);
      ctx.rotate((shape.angle * Math.PI) / 180);
      ctx.rect((-shape.w / 2) * scale, (-shape.h / 2) * scale, shape.w * scale, shape.h * scale);
      ctx.restore();
      break;
    }
    case 'ellipse':
      ctx.ellipse(shape.cx * scale, shape.cy * scale, shape.rx * scale, shape.ry * scale, 0, 0, Math.PI * 2);
      break;
    case 'rotatedEllipse':
      ctx.ellipse(
        shape.cx * scale,
        shape.cy * scale,
        shape.rx * scale,
        shape.ry * scale,
        (shape.angle * Math.PI) / 180,
        0,
        Math.PI * 2,
      );
      break;
  }
}

/** Draw one accepted shape onto a canvas context at the given scale. */
export function drawShape(ctx: CanvasRenderingContext2D, record: ShapeRecord, scale: number): void {
  ctx.fillStyle = fillStyle(record.color, record.alpha);
  tracePath(ctx, record.shape, scale);
  ctx.fill();
}
