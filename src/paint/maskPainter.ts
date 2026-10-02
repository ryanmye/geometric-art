// The paint-over-the-photo component: an overlay canvas dropped on top of a
// "host" element that already shows the picture, letting the user brush in
// where they want more detail. See mask.ts for the brush math; this file is
// just wiring it up to pointer events and drawing the overlay.

import { clearMask, createMask, isMaskPainted, strokeBrush } from './mask';

export interface MaskPainterOptions {
  /** Size of the working image the mask lines up with (not the on-screen size). */
  width: number;
  height: number;
  /** Brush radius as a fraction of the longer of width/height. Default 0.08. */
  brushSize?: number;
  /** Called once a stroke ends (pointer up) or the mask is cleared. */
  onChange?: () => void;
}

export interface MaskPainter {
  /** The live mask. Mutated in place as the user paints; do not replace it, use setMask. */
  readonly mask: Uint8Array;
  readonly width: number;
  readonly height: number;
  /** Turns painting on/off. When off, pointer input passes through to whatever is under the overlay. */
  setEnabled(on: boolean): void;
  /** Shows or hides the tint/cursor overlay (painting still works while hidden, if enabled). */
  setVisible(on: boolean): void;
  /** Brush radius as a fraction of the longer image side, e.g. 0.08 = 8% of the long side. */
  setBrushSize(fractionOfLongerSide: number): void;
  setErasing(on: boolean): void;
  /** Zeroes the mask and fires onChange. */
  clear(): void;
  /** Replaces the mask contents (e.g. restoring a saved one). Must be the same size. */
  setMask(mask: Uint8Array): void;
  /** Call after the host's on-screen size changes, so the overlay canvas is resized to match. */
  resize(): void;
  /** Removes the overlay canvas and stops listening for events. */
  dispose(): void;
}

// The tint colour (255, 70, 20, alpha up to ~0.45) is applied per-pixel in
// draw(), scaled by how painted that pixel is; it reads as a warm highlight
// against photos of any brightness, in both light and dark page themes.
const CURSOR_STROKE = 'rgba(255, 255, 255, 0.9)';
const CURSOR_SHADOW = 'rgba(0, 0, 0, 0.6)';

export function createMaskPainter(host: HTMLElement, options: MaskPainterOptions): MaskPainter {
  const width = options.width;
  const height = options.height;
  const mask = createMask(width, height);
  let brushFraction = options.brushSize ?? 0.08;
  let erasing = false;
  let enabled = true;
  let visible = true;
  // Pointer position in working-image coordinates, or null when not hovering/dragging.
  let cursor: { x: number; y: number } | null = null;
  let dragging: { x: number; y: number; pointerId: number } | null = null;

  const canvas = document.createElement('canvas');
  canvas.style.position = 'absolute';
  canvas.style.inset = '0';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  host.appendChild(canvas);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

  function brushRadius(): number {
    return brushFraction * Math.max(width, height);
  }

  /** Current overlay canvas pixels per working-image pixel, in each axis. */
  function pixelScale(): { x: number; y: number } {
    return { x: canvas.width / width, y: canvas.height / height };
  }

  // Maps a pointer event's page position to working-image coordinates.
  // getBoundingClientRect gives the canvas's on-screen (CSS pixel) size and
  // position, whatever the device pixel ratio is; dividing the event's
  // position within that box by the box size, then multiplying by the
  // working image size, lands exactly on the right working pixel regardless
  // of display size or pixel density.
  function toWorkingCoords(event: PointerEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * width;
    const y = ((event.clientY - rect.top) / rect.height) * height;
    return { x, y };
  }

  function draw(): void {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!visible) return;
    const scale = pixelScale();

    if (isMaskPainted(mask)) {
      // Paint the tint straight from the mask: one image-sized ImageData,
      // scaled up to the overlay's on-screen pixel size.
      const tintCanvas = document.createElement('canvas');
      tintCanvas.width = width;
      tintCanvas.height = height;
      const tintCtx = tintCanvas.getContext('2d') as CanvasRenderingContext2D;
      const image = tintCtx.createImageData(width, height);
      const [r, g, b] = [255, 70, 20];
      for (let i = 0; i < mask.length; i++) {
        const alpha = Math.round((mask[i] / 255) * 115); // ~0.45 * 255
        image.data[i * 4] = r;
        image.data[i * 4 + 1] = g;
        image.data[i * 4 + 2] = b;
        image.data[i * 4 + 3] = alpha;
      }
      tintCtx.putImageData(image, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(tintCanvas, 0, 0, canvas.width, canvas.height);
    }

    if (cursor && enabled) {
      const radius = brushRadius();
      ctx.beginPath();
      ctx.ellipse(cursor.x * scale.x, cursor.y * scale.y, radius * scale.x, radius * scale.y, 0, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = CURSOR_SHADOW;
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.strokeStyle = CURSOR_STROKE;
      ctx.stroke();
    }
  }

  function paintTo(point: { x: number; y: number }): void {
    const from = dragging ?? point;
    strokeBrush(mask, width, height, from.x, from.y, point.x, point.y, brushRadius(), erasing);
    draw();
  }

  function onPointerDown(event: PointerEvent): void {
    if (!enabled) return;
    canvas.setPointerCapture(event.pointerId);
    const point = toWorkingCoords(event);
    cursor = point;
    dragging = { x: point.x, y: point.y, pointerId: event.pointerId };
    paintTo(point);
    event.preventDefault();
  }

  function onPointerMove(event: PointerEvent): void {
    if (!enabled) return;
    const point = toWorkingCoords(event);
    cursor = point;
    if (dragging && dragging.pointerId === event.pointerId) {
      paintTo(point);
      dragging = { x: point.x, y: point.y, pointerId: event.pointerId };
    } else {
      draw();
    }
  }

  function endDrag(event: PointerEvent): void {
    if (dragging && dragging.pointerId === event.pointerId) {
      dragging = null;
      options.onChange?.();
    }
  }

  function onPointerUp(event: PointerEvent): void {
    endDrag(event);
  }

  function onPointerCancel(event: PointerEvent): void {
    endDrag(event);
  }

  function onPointerLeave(): void {
    if (!dragging) {
      cursor = null;
      draw();
    }
  }

  function addListeners(): void {
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerCancel);
    canvas.addEventListener('pointerleave', onPointerLeave);
  }

  function removeListeners(): void {
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerCancel);
    canvas.removeEventListener('pointerleave', onPointerLeave);
  }

  addListeners();

  function applyEnabled(): void {
    // Let pointer input pass through to the photo canvas underneath when disabled.
    canvas.style.pointerEvents = enabled ? 'auto' : 'none';
    canvas.style.touchAction = enabled ? 'none' : 'auto';
  }

  function resize(): void {
    const rect = host.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const pixelWidth = Math.max(1, Math.round(rect.width * dpr));
    const pixelHeight = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    draw();
  }

  applyEnabled();
  resize();
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);

  return {
    mask,
    width,
    height,
    setEnabled(on) {
      enabled = on;
      if (!on) {
        dragging = null;
        cursor = null;
      }
      applyEnabled();
      draw();
    },
    setVisible(on) {
      visible = on;
      draw();
    },
    setBrushSize(fractionOfLongerSide) {
      brushFraction = fractionOfLongerSide;
      draw();
    },
    setErasing(on) {
      erasing = on;
    },
    clear() {
      clearMask(mask);
      draw();
      options.onChange?.();
    },
    setMask(newMask) {
      if (newMask.length !== mask.length) {
        throw new Error(`setMask: expected length ${mask.length}, got ${newMask.length}`);
      }
      mask.set(newMask);
      draw();
    },
    resize,
    dispose() {
      removeListeners();
      resizeObserver.disconnect();
      canvas.remove();
    },
  };
}
