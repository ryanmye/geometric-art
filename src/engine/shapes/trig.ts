// Sine and cosine of an angle in degrees, using only + - * /.
//
// Math.sin and Math.cos may differ in their last digit between JavaScript
// engines. Using our own keeps the pixels a rotated shape covers, and so the
// whole run, identical in every browser and in Node for the same seed.
// Accuracy is within about 1e-16 of the true value.

/** [sin, cos] of `degrees`. */
export function sinCosDegrees(degrees: number): [number, number] {
  // Reduce to [0, 360), then to an angle r within 45 degrees of a multiple of 90.
  let a = degrees % 360;
  if (a < 0) a += 360;
  const quarter = Math.round(a / 90); // 0..4
  const r = ((a - quarter * 90) * Math.PI) / 180; // -pi/4 .. pi/4 radians
  const s = sinSeries(r);
  const c = cosSeries(r);
  // sin/cos of (r + quarter * 90 degrees).
  switch (quarter % 4) {
    case 0:
      return [s, c];
    case 1:
      return [c, -s];
    case 2:
      return [-s, -c];
    default:
      return [-c, s];
  }
}

// Taylor series, accurate to double precision for |x| <= pi/4.
function sinSeries(x: number): number {
  const x2 = x * x;
  let term = x;
  let sum = x;
  for (let n = 1; n <= 9; n++) {
    term *= -x2 / ((2 * n) * (2 * n + 1));
    sum += term;
  }
  return sum;
}

function cosSeries(x: number): number {
  const x2 = x * x;
  let term = 1;
  let sum = 1;
  for (let n = 1; n <= 9; n++) {
    term *= -x2 / ((2 * n - 1) * (2 * n));
    sum += term;
  }
  return sum;
}
