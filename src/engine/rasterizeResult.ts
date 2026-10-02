import type { Bitmap, RunResult } from './types';
import { createScanlines } from './scanlines';
import { rasterizeShape } from './shapes';
import { blend } from './blend';

/**
 * Repaint a result at working size exactly as the engine painted it (pixel
 * centres, no anti-aliasing). For the Node script and tests; the page draws
 * with canvas instead.
 */
export function rasterizeResult(result: RunResult): Bitmap {
  const { width, height, background } = result;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = background[0];
    data[i + 1] = background[1];
    data[i + 2] = background[2];
    data[i + 3] = 255;
  }
  const lines = createScanlines(height);
  for (const record of result.shapes) {
    rasterizeShape(record.shape, lines, width, height);
    const inverse = 255 - record.alpha;
    for (let k = 0; k < lines.count; k++) {
      const y = lines.data[3 * k];
      for (let x = lines.data[3 * k + 1]; x <= lines.data[3 * k + 2]; x++) {
        const i = (y * width + x) * 4;
        for (let c = 0; c < 3; c++) {
          data[i + c] = blend(record.color[c] * record.alpha + 127, data[i + c], inverse);
        }
      }
    }
  }
  return { width, height, data };
}
