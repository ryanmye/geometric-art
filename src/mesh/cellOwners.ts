// The owner of every pixel in a polygon mesh, worked out from scratch by
// checking every point (the rule of cells.ts: nearest pixel centre, ties to
// the lower index). Slow but simple; used to draw finished results and by
// the tests as an independent check of the optimiser's incremental owners.

export function cellOwners(points: Array<[number, number]>, width: number, height: number): Int32Array {
  const owner = new Int32Array(width * height);
  const count = points.length;
  const xs = new Float64Array(count);
  const ys = new Float64Array(count);
  for (let p = 0; p < count; p++) {
    xs[p] = 2 * points[p][0];
    ys[p] = 2 * points[p][1];
  }
  for (let py = 0; py < height; py++) {
    const cy = 2 * py + 1;
    for (let px = 0; px < width; px++) {
      const cx = 2 * px + 1;
      let best = 0;
      let bestDistance = Infinity;
      for (let p = 0; p < count; p++) {
        const dx = cx - xs[p];
        const dy = cy - ys[p];
        const d = dx * dx + dy * dy;
        if (d < bestDistance) {
          // Strictly nearer only, so on a tie the lower index stays.
          best = p;
          bestDistance = d;
        }
      }
      owner[py * width + px] = best;
    }
  }
  return owner;
}
