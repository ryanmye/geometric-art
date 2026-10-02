/**
 * Sobel gradient magnitude of a luminance map: how fast brightness changes
 * at each pixel, i.e. how much of an "edge" it is. Pixels just outside the
 * image are treated as a copy of the nearest edge pixel (clamped), so the
 * border doesn't fake extra edges.
 *
 *   Gx = [-1 0 1]   Gy = [-1 -2 -1]
 *        [-2 0 2]        [ 0  0  0]
 *        [-1 0 1]        [ 1  2  1]
 *
 * magnitude = sqrt(Gx^2 + Gy^2), the only non-arithmetic op being sqrt,
 * which Node and Chrome agree on bit-for-bit (unlike exp/log/sin/cos).
 */
export function sobelMagnitude(luminance: Float32Array, width: number, height: number): Float32Array {
  const magnitude = new Float32Array(width * height);
  const at = (x: number, y: number): number => {
    const cx = x < 0 ? 0 : x >= width ? width - 1 : x;
    const cy = y < 0 ? 0 : y >= height ? height - 1 : y;
    return luminance[cy * width + cx];
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const gx =
        -at(x - 1, y - 1) + at(x + 1, y - 1) - 2 * at(x - 1, y) + 2 * at(x + 1, y) - at(x - 1, y + 1) + at(x + 1, y + 1);
      const gy =
        -at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1) + at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1);
      magnitude[y * width + x] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return magnitude;
}
