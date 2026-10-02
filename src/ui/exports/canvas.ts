// Drawing a picture or frame onto a fresh canvas at a chosen size.

/** Pixel size for a working image scaled so its longest side is `longestSide`. */
export function outputSize(width: number, height: number, longestSide: number): { width: number; height: number } {
  const scale = longestSide / Math.max(width, height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** A canvas of the given size with `draw` applied at the matching scale. */
export function drawToCanvas(
  sourceWidth: number,
  size: { width: number; height: number },
  draw: (ctx: CanvasRenderingContext2D, scale: number) => void,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('This browser cannot draw to a canvas.');
  draw(ctx, size.width / sourceWidth);
  return canvas;
}

export async function canvasToPNG(canvas: HTMLCanvasElement): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('PNG encoding failed');
  return blob;
}
