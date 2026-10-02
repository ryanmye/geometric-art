/**
 * Box blur, repeated three times, as a stand-in for a Gaussian blur.
 *
 * We can't use Math.exp to build a real Gaussian kernel (it rounds
 * differently in Node's V8 than in Chrome's, which would make the engine
 * produce different pictures on different machines for the same seed).
 * Averaging a window of pixels three times in a row uses only +, -, *, /
 * and converges to a Gaussian-ish bump by the central limit theorem, which
 * is close enough for weighting purposes.
 *
 * Pixels just past the edge of the image are treated as a copy of the
 * nearest edge pixel (clamped), the same as sobel.ts does. A strong edge
 * at the left border should not raise importance at the right border, so
 * the window never wraps around.
 */
export function boxBlur(data: Float32Array, width: number, height: number, radius: number, passes = 3): Float32Array {
  let current = data;
  if (radius <= 0) return current.slice();
  for (let pass = 0; pass < passes; pass++) {
    current = boxBlurPass(current, width, height, radius);
  }
  return current;
}

function boxBlurPass(data: Float32Array, width: number, height: number, radius: number): Float32Array {
  const horizontal = new Float32Array(width * height);
  blurRows(data, horizontal, width, height, radius);
  const vertical = new Float32Array(width * height);
  blurColumns(horizontal, vertical, width, height, radius);
  return vertical;
}

// Averages each pixel with `radius` neighbours on either side, along a row,
// clamping to the nearest edge pixel past the left/right border.
function blurRows(src: Float32Array, dst: Float32Array, width: number, height: number, radius: number): void {
  const windowSize = 2 * radius + 1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        let sx = x + k;
        if (sx < 0) sx = 0;
        else if (sx >= width) sx = width - 1;
        sum += src[row + sx];
      }
      dst[row + x] = sum / windowSize;
    }
  }
}

// Same averaging, down a column, clamping to the nearest edge pixel past
// the top/bottom border.
function blurColumns(src: Float32Array, dst: Float32Array, width: number, height: number, radius: number): void {
  const windowSize = 2 * radius + 1;
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        let sy = y + k;
        if (sy < 0) sy = 0;
        else if (sy >= height) sy = height - 1;
        sum += src[sy * width + x];
      }
      dst[y * width + x] = sum / windowSize;
    }
  }
}
