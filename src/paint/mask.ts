/**
 * Pure logic for the "paint more detail here" mask: a Uint8Array the same
 * size as the working image, 0 = untouched, 255 = fully painted. No DOM
 * here, so this file is easy to test and easy to reuse from a worker later.
 *
 * Only basic arithmetic and Math.sqrt/floor/ceil/round/abs/min/max are used,
 * matching the rest of the project (no exp/pow/trig).
 */

/** A fresh, fully-untouched mask for a working image of this size. */
export function createMask(width: number, height: number): Uint8Array {
  return new Uint8Array(width * height);
}

/** Sets every pixel back to untouched. */
export function clearMask(mask: Uint8Array): void {
  mask.fill(0);
}

/** True if any pixel has been painted at all. */
export function isMaskPainted(mask: Uint8Array): boolean {
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] !== 0) return true;
  }
  return false;
}

/**
 * The brush's strength at a distance from its centre, 0..255: full strength
 * out to half the radius, then a straight-line taper down to 0 at the
 * radius. (A cone rather than a sharp-edged disc, so a stamp does not leave
 * a visible ring.)
 */
function brushFalloff(distance: number, radius: number): number {
  if (radius <= 0) return 0;
  const inner = radius * 0.5;
  if (distance <= inner) return 255;
  if (distance >= radius) return 0;
  const fraction = (radius - distance) / (radius - inner);
  return Math.round(255 * fraction);
}

/**
 * Stamps one soft round brush into `mask` at working-image point (cx, cy).
 * Painting (erase = false) only ever raises a pixel's value (max with what
 * is already there); erasing only ever lowers it. Pixels outside the image
 * are skipped, so stamps near or past the border never write out of bounds.
 */
export function stampBrush(
  mask: Uint8Array,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
  erase: boolean,
): void {
  if (radius <= 0) return;
  const minX = Math.max(0, Math.floor(cx - radius));
  const maxX = Math.min(width - 1, Math.ceil(cx + radius));
  const minY = Math.max(0, Math.floor(cy - radius));
  const maxY = Math.min(height - 1, Math.ceil(cy + radius));

  for (let y = minY; y <= maxY; y++) {
    const dy = y - cy;
    for (let x = minX; x <= maxX; x++) {
      const dx = x - cx;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > radius) continue;
      const strength = brushFalloff(distance, radius);
      const i = y * width + x;
      if (erase) {
        mask[i] = Math.min(mask[i], 255 - strength);
      } else {
        mask[i] = Math.max(mask[i], strength);
      }
    }
  }
}

/**
 * Stamps a whole stroke from (x0, y0) to (x1, y1), spacing the stamps closely
 * enough (a quarter of the brush radius, at least one pixel) that a fast
 * drag still leaves a solid, gap-free line rather than a dotted one.
 */
export function strokeBrush(
  mask: Uint8Array,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius: number,
  erase: boolean,
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const step = Math.max(1, radius * 0.25);
  const steps = Math.max(1, Math.ceil(distance / step));

  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    stampBrush(mask, width, height, x0 + dx * t, y0 + dy * t, radius, erase);
  }
}
