// A seed animation as one self-contained SVG that loops by itself, with no
// script: it works opened directly in a browser and in an <img> tag.
//
// The background and the shared shapes are drawn once, underneath. Each
// frame's own shapes go in a group that is hidden except during its turn.
// One CSS animation, `frame`, shows a group for the first 1/N of the loop and
// hides it for the rest ("step-end" makes the switch instant, not a fade);
// each group starts that animation at a different point (a negative
// animation-delay), so frame i is the visible one from i/N to (i+1)/N.

import type { AnimationResult } from '../engine/types';
import { shapesAfterPrefix } from '../engine/animationPlan';
import { rgb, shapeTag } from './toSVG';

export function toAnimatedSVG(animation: AnimationResult, fps: number): string {
  const { width, height, background, frames, prefix } = animation;
  const count = frames.length;
  if (count === 0) throw new Error('The animation has no finished frames yet');
  const frameSeconds = 1 / fps;
  const loopSeconds = count * frameSeconds;
  // Share of the loop each frame is visible, rounded up a little so there is
  // never a gap between one frame switching off and the next switching on.
  const visiblePercent = Math.min(100, Math.ceil((100 / count) * 10000) / 10000);

  const lines: string[] = [];
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
  );
  lines.push('<style>');
  lines.push(`@keyframes frame { 0% { visibility: visible; } ${visiblePercent}%, 100% { visibility: hidden; } }`);
  lines.push(`.f { visibility: hidden; animation: frame ${seconds(loopSeconds)} step-end infinite; }`);
  for (let i = 1; i < count; i++) {
    lines.push(`.f${i} { animation-delay: -${seconds((count - i) * frameSeconds)}; }`);
  }
  // People who ask for less motion see the first frame, still.
  lines.push('@media (prefers-reduced-motion: reduce) { .f { animation: none; } .f0 { visibility: visible; } }');
  lines.push('</style>');
  lines.push(`<rect width="${width}" height="${height}" fill="${rgb(background)}"/>`);

  lines.push('<g id="shared">');
  for (const record of prefix) lines.push(shapeTag(record));
  lines.push('</g>');

  for (let i = 0; i < count; i++) {
    lines.push(`<g class="f f${i}">`);
    for (const record of shapesAfterPrefix(animation, i)) lines.push(shapeTag(record));
    lines.push('</g>');
  }
  lines.push('</svg>');
  return lines.join('\n');
}

/** A CSS time in seconds, without long decimal tails. */
function seconds(value: number): string {
  return `${Math.round(value * 10000) / 10000}s`;
}
