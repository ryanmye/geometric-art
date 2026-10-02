// The picture area: a canvas sized to fit the available space at the image's
// aspect ratio, at the screen's real pixel density, plus an overlay showing
// the original photo while "compare" is held.
//
// What is drawn on the canvas is up to the current run: it hands the stage a
// `draw` function, which the stage calls whenever the canvas changes size.

export type DrawFunction = (ctx: CanvasRenderingContext2D, scale: number) => void;

export interface Stage {
  /** Show the empty "drop a photo" state. */
  showEmpty(): void;
  /** Show the original photo (before a run). */
  showPhoto(photo: ImageBitmap): void;
  /**
   * Show a run's picture. `size` is the working image size; `draw` paints the
   * whole picture at `scale` output pixels per working pixel.
   */
  showDrawing(photo: ImageBitmap, size: { width: number; height: number }, draw: DrawFunction): void;
  /** Call `draw` again now (e.g. a new frame has started). */
  redraw(): void;
  /** The picture canvas's 2D context, for drawing new shapes as they come. */
  readonly context: CanvasRenderingContext2D;
  /** Output pixels per working-image pixel at the current size. */
  readonly scale: number;
  setComparing(on: boolean): void;
}

export function setUpStage(elements: {
  stage: HTMLElement;
  frame: HTMLElement;
  empty: HTMLElement;
  picture: HTMLCanvasElement;
  original: HTMLCanvasElement;
  label: HTMLElement;
}): Stage {
  const { stage, frame, empty, picture, original, label } = elements;
  const pictureCtx = picture.getContext('2d') as CanvasRenderingContext2D;
  const originalCtx = original.getContext('2d') as CanvasRenderingContext2D;

  let photo: ImageBitmap | null = null;
  // Set while a run is shown.
  let drawing: { size: { width: number; height: number }; draw: DrawFunction } | null = null;
  let scale = 1;
  let comparing = false;

  /** Size both canvases to fit the stage, then redraw everything. */
  function layout(): void {
    if (!photo) return;
    const box = stage.getBoundingClientRect();
    const style = getComputedStyle(stage);
    const availableWidth = box.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const availableHeight = box.height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    if (availableWidth <= 0 || availableHeight <= 0) return;

    // Use the working image's exact size once a run exists, else the photo's.
    const imageWidth = drawing ? drawing.size.width : photo.width;
    const imageHeight = drawing ? drawing.size.height : photo.height;
    const fit = Math.min(availableWidth / imageWidth, availableHeight / imageHeight);
    const cssWidth = Math.max(1, Math.floor(imageWidth * fit));
    const cssHeight = Math.max(1, Math.floor(imageHeight * fit));
    const dpr = window.devicePixelRatio || 1;
    const pixelWidth = Math.round(cssWidth * dpr);
    const pixelHeight = Math.round(cssHeight * dpr);

    for (const canvas of [picture, original]) {
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    }
    scale = pixelWidth / imageWidth;
    drawPhoto(originalCtx, photo, original.width, original.height);
    redraw();
  }

  function redraw(): void {
    if (!photo) return;
    if (drawing) drawing.draw(pictureCtx, scale);
    else drawPhoto(pictureCtx, photo, picture.width, picture.height);
  }

  function updateCompare(): void {
    const show = comparing && drawing !== null;
    original.hidden = !show;
    label.hidden = !show;
  }

  new ResizeObserver(() => layout()).observe(stage);

  // Zooming or moving the window to another screen changes the pixel
  // density; watch for a change from the current value, then watch again.
  function watchPixelRatio(): void {
    matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener(
      'change',
      () => {
        layout();
        watchPixelRatio();
      },
      { once: true },
    );
  }
  watchPixelRatio();

  return {
    showEmpty() {
      photo = null;
      drawing = null;
      frame.hidden = true;
      empty.hidden = false;
      updateCompare();
    },
    showPhoto(newPhoto) {
      photo = newPhoto;
      drawing = null;
      frame.hidden = false;
      empty.hidden = true;
      updateCompare();
      layout();
    },
    showDrawing(newPhoto, size, draw) {
      photo = newPhoto;
      drawing = { size, draw };
      frame.hidden = false;
      empty.hidden = true;
      updateCompare();
      layout();
    },
    redraw,
    get context() {
      return pictureCtx;
    },
    get scale() {
      return scale;
    },
    setComparing(on) {
      comparing = on;
      updateCompare();
    },
  };
}

function drawPhoto(ctx: CanvasRenderingContext2D, photo: ImageBitmap, width: number, height: number): void {
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(photo, 0, 0, width, height);
}
