import type { RunResult } from '../engine/types';
import { drawResult } from './drawResult';

/**
 * Render a result to a PNG blob at the given longest-side size, scaling up
 * (or down) from the working-image coordinates the shapes are stored in.
 */
export async function toPNG(result: RunResult, longestSide: number): Promise<Blob> {
  const scale = longestSide / Math.max(result.width, result.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(result.width * scale);
  canvas.height = Math.round(result.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  drawResult(ctx, result, scale);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('PNG encoding failed');
  return blob;
}
