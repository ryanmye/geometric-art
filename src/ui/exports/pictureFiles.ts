// Single-picture exports, the same for every engine.

import type { ExportFile } from './animationFiles';
import { canvasToPNG, drawToCanvas, outputSize } from './canvas';
import type { PictureExports } from './types';

export function pictureSVG(picture: PictureExports): ExportFile {
  return { name: `${picture.baseName}.svg`, blob: new Blob([picture.svg()], { type: 'image/svg+xml' }) };
}

export function pictureJSON(picture: PictureExports): ExportFile {
  return { name: `${picture.baseName}.json`, blob: new Blob([picture.json()], { type: 'application/json' }) };
}

/** The picture drawn (anti-aliased) at the given longest side. */
export async function picturePNG(picture: PictureExports, size: number): Promise<ExportFile> {
  const canvas = drawToCanvas(picture.width, outputSize(picture.width, picture.height, size), (ctx, scale) =>
    picture.draw(ctx, scale),
  );
  return { name: `${picture.baseName}-${size}px.png`, blob: await canvasToPNG(canvas) };
}
