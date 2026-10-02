import { afterEach, describe, expect, it, vi } from 'vitest';
import { firstStepQuality, shrinkInSteps, shrinkSteps, type AnyCanvas } from '../../src/ui/shrinkPhoto';

describe('the steps for shrinking a large photo', () => {
  it('starts at the largest power-of-two multiple of the target that fits, then halves', () => {
    expect(shrinkSteps({ width: 12000, height: 9000 }, { width: 1024, height: 768 })).toEqual([
      { width: 8192, height: 6144 },
      { width: 4096, height: 3072 },
      { width: 2048, height: 1536 },
      { width: 1024, height: 768 },
    ]);
    // Just over the target: one step.
    expect(shrinkSteps({ width: 1025, height: 769 }, { width: 1024, height: 768 })).toEqual([{ width: 1024, height: 768 }]);
    // Exactly twice the target: a copy at full size, then one halving.
    expect(shrinkSteps({ width: 2048, height: 1536 }, { width: 1024, height: 768 })).toEqual([
      { width: 2048, height: 1536 },
      { width: 1024, height: 768 },
    ]);
  });

  it("uses plain smoothing for a first step that shrinks by at most half, 'high' otherwise", () => {
    expect(firstStepQuality({ width: 12000, height: 9000 }, { width: 8192, height: 6144 })).toBe('low');
    expect(firstStepQuality({ width: 2048, height: 1536 }, { width: 2048, height: 1536 })).toBe('low');
    // A very thin image: the short side cannot be doubled, so the long side shrinks by more than half.
    expect(firstStepQuality({ width: 20000, height: 30 }, { width: 1024, height: 2 })).toBe('high');
    // A 1 px line is stretched to the 2 px minimum.
    expect(firstStepQuality({ width: 1, height: 5000 }, { width: 2, height: 1024 })).toBe('high');
  });
});

/** A stand-in for a canvas that records what was drawn and whether it was emptied. */
function fakeCanvas(width: number, height: number, failOnDraw: boolean) {
  const draws: Array<{ quality: ImageSmoothingQuality; width: number; height: number }> = [];
  const ctx = {
    imageSmoothingEnabled: false,
    imageSmoothingQuality: 'low' as ImageSmoothingQuality,
    drawImage(_source: unknown, _x: number, _y: number, w: number, h: number) {
      if (failOnDraw) throw new Error('out of memory');
      draws.push({ quality: ctx.imageSmoothingQuality, width: w, height: h });
    },
  };
  return { width, height, draws, getContext: () => ctx };
}

function fakePhoto(width: number, height: number) {
  return { width, height, closed: false, close() { this.closed = true; } };
}

describe('shrinking in steps', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('draws each step, then empties every canvas and closes the photo', async () => {
    vi.stubGlobal('createImageBitmap', async (canvas: { width: number; height: number }) => ({ width: canvas.width, height: canvas.height }));
    const canvases: Array<ReturnType<typeof fakeCanvas>> = [];
    const photo = fakePhoto(12000, 9000);
    const copy = await shrinkInSteps(photo as unknown as ImageBitmap, { width: 1024, height: 768 }, (w, h) => {
      const canvas = fakeCanvas(w, h, false);
      canvases.push(canvas);
      return canvas as unknown as AnyCanvas;
    });
    expect(copy).toEqual({ width: 1024, height: 768 });
    expect(canvases.map((c) => c.draws[0])).toEqual([
      { quality: 'low', width: 8192, height: 6144 },
      { quality: 'low', width: 4096, height: 3072 },
      { quality: 'low', width: 2048, height: 1536 },
      { quality: 'low', width: 1024, height: 768 },
    ]);
    expect(canvases.every((c) => c.width === 0 && c.height === 0)).toBe(true);
    expect(photo.closed).toBe(true);
  });

  it('also empties the canvases and closes the photo when a step fails', async () => {
    const canvases: Array<ReturnType<typeof fakeCanvas>> = [];
    const photo = fakePhoto(12000, 9000);
    const shrinking = shrinkInSteps(photo as unknown as ImageBitmap, { width: 1024, height: 768 }, (w, h) => {
      const canvas = fakeCanvas(w, h, canvases.length === 2); // the third step fails
      canvases.push(canvas);
      return canvas as unknown as AnyCanvas;
    });
    await expect(shrinking).rejects.toThrow('out of memory');
    expect(canvases).toHaveLength(3);
    expect(canvases.every((c) => c.width === 0 && c.height === 0)).toBe(true);
    expect(photo.closed).toBe(true);
  });
});
