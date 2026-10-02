import type { RGB, RunResult, Shape, ShapeRecord } from '../engine/types';

export function rgb([r, g, b]: RGB): string {
  return `rgb(${r},${g},${b})`;
}

/** A coordinate rounded to 0.01 px: invisible at any export size, and keeps the file small. */
function n(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** Build the native SVG element (polygon/rect/ellipse) for one shape, unrotated. */
function shapeElement(shape: Shape): string {
  switch (shape.type) {
    case 'triangle':
      return `<polygon points="${n(shape.x1)},${n(shape.y1)} ${n(shape.x2)},${n(shape.y2)} ${n(shape.x3)},${n(shape.y3)}"`;
    case 'rectangle':
      return `<rect x="${n(shape.x1)}" y="${n(shape.y1)}" width="${n(shape.x2 - shape.x1)}" height="${n(shape.y2 - shape.y1)}"`;
    case 'rotatedRectangle':
      return (
        `<rect x="${n(shape.cx - shape.w / 2)}" y="${n(shape.cy - shape.h / 2)}" ` +
        `width="${n(shape.w)}" height="${n(shape.h)}" transform="rotate(${n(shape.angle)} ${n(shape.cx)} ${n(shape.cy)})"`
      );
    case 'ellipse':
      return `<ellipse cx="${n(shape.cx)}" cy="${n(shape.cy)}" rx="${n(shape.rx)}" ry="${n(shape.ry)}"`;
    case 'rotatedEllipse':
      return (
        `<ellipse cx="${n(shape.cx)}" cy="${n(shape.cy)}" rx="${n(shape.rx)}" ry="${n(shape.ry)}" ` +
        `transform="rotate(${n(shape.angle)} ${n(shape.cx)} ${n(shape.cy)})"`
      );
  }
}

/** One shape as a complete SVG element with its fill and opacity. */
export function shapeTag(record: ShapeRecord): string {
  const open = shapeElement(record.shape);
  const fill = rgb(record.color);
  const opacity = record.alpha / 255;
  return `${open} fill="${fill}" fill-opacity="${opacity}"/>`;
}

/** Render a result as a standalone SVG document string. */
export function toSVG(result: RunResult): string {
  const { width, height, background, shapes } = result;
  const lines: string[] = [];
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
  );
  lines.push(`<rect width="${width}" height="${height}" fill="${rgb(background)}"/>`);
  for (const record of shapes) {
    lines.push(shapeTag(record));
  }
  lines.push('</svg>');
  return lines.join('\n');
}
