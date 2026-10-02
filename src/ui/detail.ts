// The "Detail" settings: how strongly to focus shapes on edges and features,
// a view of the resulting importance map, and a brush for painting where
// detail matters. Together they produce the per-pixel weights for a run.

import type { Bitmap, ImportanceInfo } from '../engine/types';
import { applyPaintedMask, computeImportance, importanceToBitmap } from '../importance';
import { isMaskPainted } from '../paint/mask';
import { createMaskPainter, type MaskPainter } from '../paint/maskPainter';

export interface Detail {
  /**
   * The photo at working size changed (new photo, or a new working size):
   * start a fresh, empty painting for it. null when there is no photo.
   */
  setImage(target: Bitmap | null): void;
  /** Painting and the map view are only available when no run is in progress. */
  setAvailable(available: boolean): void;
  /** True while the paint brush is active. */
  readonly painting: boolean;
  /** Called when painting starts or stops (the page shows the photo while painting). */
  onPaintingChange: ((painting: boolean) => void) | null;
  /** Weights for a run, or null when focus is off and nothing is painted (a plain run). */
  weightsFor(target: Bitmap): { weights: Float32Array; importance: ImportanceInfo } | null;
  /** The painted mask (for checking from scripts), or null. */
  mask(): Uint8Array | null;
}

export function setUpDetail(elements: {
  /** The element around the picture; the brush overlay is placed in it. */
  host: HTMLElement;
  strength: HTMLInputElement;
  mapView: HTMLCanvasElement;
  mapButton: HTMLButtonElement;
  paintButton: HTMLButtonElement;
  tools: HTMLElement;
  eraseRadios: HTMLInputElement[];
  brushSize: HTMLInputElement;
  clearButton: HTMLButtonElement;
  hint: HTMLElement;
}): Detail {
  const { host, strength, mapView, mapButton, paintButton, tools, eraseRadios, brushSize, clearButton, hint } =
    elements;
  let target: Bitmap | null = null;
  let painter: MaskPainter | null = null;
  let available = false;
  let painting = false;
  let showingMap = false;

  /** Strength 0-1 from the slider (stored as 0-100). */
  function strengthValue(): number {
    return Number(strength.value) / 100;
  }

  function painted(): boolean {
    return painter !== null && isMaskPainted(painter.mask);
  }

  /** Decimal weights for the current settings and painting. */
  function currentWeights(image: Bitmap): Float32Array {
    const weights = computeImportance(image, { strength: strengthValue() });
    return painter && painted() ? applyPaintedMask(weights, painter.mask) : weights;
  }

  function drawMap(): void {
    if (!showingMap || !target) return;
    const bitmap = importanceToBitmap(currentWeights(target), target.width, target.height);
    mapView.width = target.width;
    mapView.height = target.height;
    const ctx = mapView.getContext('2d') as CanvasRenderingContext2D;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(bitmap.data), bitmap.width, bitmap.height), 0, 0);
  }

  function update(): void {
    const ready = available && target !== null;
    if (!ready && painting) setPainting(false);
    if (!ready && showingMap) showingMap = false;
    paintButton.disabled = !ready;
    mapButton.disabled = !ready;
    paintButton.setAttribute('aria-pressed', String(painting));
    paintButton.textContent = painting ? 'Done painting' : 'Paint detail';
    mapButton.setAttribute('aria-pressed', String(showingMap));
    mapButton.textContent = showingMap ? 'Hide map' : 'Show map';
    mapView.hidden = !showingMap;
    tools.hidden = !painting;
    clearButton.disabled = !painted();

    const parts: string[] = [];
    if (strengthValue() === 0 && !painted()) parts.push('Off: every pixel counts the same.');
    if (painted()) parts.push('Painted areas get extra detail.');
    if (showingMap) parts.push('Map: brighter areas get more detail.');
    hint.textContent = parts.join(' ');
    drawMap();
  }

  function setPainting(on: boolean): void {
    painting = on;
    painter?.setEnabled(on);
    painter?.setVisible(on);
    detail.onPaintingChange?.(on);
  }

  function erasing(): boolean {
    return eraseRadios.some((radio) => radio.checked && radio.value === 'erase');
  }

  strength.addEventListener('input', update);
  mapButton.addEventListener('click', () => {
    showingMap = !showingMap;
    update();
  });
  paintButton.addEventListener('click', () => {
    setPainting(!painting);
    update();
  });
  for (const radio of eraseRadios) radio.addEventListener('change', () => painter?.setErasing(erasing()));
  brushSize.addEventListener('input', () => painter?.setBrushSize(Number(brushSize.value) / 100));
  clearButton.addEventListener('click', () => painter?.clear());

  const detail: Detail = {
    setImage(image) {
      painter?.dispose();
      painter = null;
      target = image;
      if (image) {
        painter = createMaskPainter(host, {
          width: image.width,
          height: image.height,
          brushSize: Number(brushSize.value) / 100,
          onChange: update,
        });
        painter.setErasing(erasing());
        painter.setEnabled(painting);
        painter.setVisible(painting);
      }
      update();
    },
    setAvailable(on) {
      available = on;
      update();
    },
    get painting() {
      return painting;
    },
    onPaintingChange: null,
    weightsFor(image) {
      const strengthNow = strengthValue();
      const isPainted = painted();
      if (strengthNow === 0 && !isPainted) return null;
      if (painter && (painter.width !== image.width || painter.height !== image.height)) {
        throw new Error('The painted detail does not match the working size; paint again.');
      }
      return { weights: currentWeights(image), importance: { strength: strengthNow, painted: isPainted } };
    },
    mask: () => (painter ? painter.mask : null),
  };
  update();
  return detail;
}
