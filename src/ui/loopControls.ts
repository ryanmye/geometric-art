// The "Loop" panel shown during a seed animation: a small preview of the
// finished frames while the rest are computed, play/pause, and the speed.
// The speed and play button work at any time, without recomputing.

export interface LoopControls {
  /** Frames per second chosen on the speed slider. */
  readonly fps: number;
  setFps(fps: number): void;
  /** Show or hide the whole panel. */
  show(on: boolean): void;
  /** The small preview canvas, sized to the panel at the given image aspect ratio. */
  showPreview(width: number, height: number): CanvasRenderingContext2D;
  hidePreview(): void;
  setHint(text: string): void;
  setPlayButton(enabled: boolean, playing: boolean): void;
  /** Set by the current animation run. */
  onPlayToggle: (() => void) | null;
  onFpsChange: ((fps: number) => void) | null;
}

export function setUpLoopControls(elements: {
  group: HTMLElement;
  preview: HTMLCanvasElement;
  hint: HTMLElement;
  playButton: HTMLButtonElement;
  speed: HTMLInputElement;
  speedOut: HTMLOutputElement;
}): LoopControls {
  const { group, preview, hint, playButton, speed, speedOut } = elements;

  const controls: LoopControls = {
    get fps() {
      return Number(speed.value);
    },
    setFps(fps) {
      speed.value = String(fps);
      showSpeed();
    },
    show(on) {
      group.hidden = !on;
    },
    showPreview(width, height) {
      preview.hidden = false;
      // Fit inside the panel width and at most 220 CSS pixels tall.
      const available = preview.parentElement?.clientWidth || 260;
      const fit = Math.min(available / width, 220 / height);
      const cssWidth = Math.floor(width * fit);
      const cssHeight = Math.floor(height * fit);
      const dpr = window.devicePixelRatio || 1;
      preview.style.width = `${cssWidth}px`;
      preview.style.height = `${cssHeight}px`;
      preview.width = Math.round(cssWidth * dpr);
      preview.height = Math.round(cssHeight * dpr);
      return preview.getContext('2d') as CanvasRenderingContext2D;
    },
    hidePreview() {
      preview.hidden = true;
    },
    setHint(text) {
      hint.textContent = text;
      hint.hidden = text === '';
    },
    setPlayButton(enabled, playing) {
      playButton.disabled = !enabled;
      playButton.textContent = playing ? 'Pause loop' : 'Play loop';
    },
    onPlayToggle: null,
    onFpsChange: null,
  };

  function showSpeed(): void {
    speedOut.value = `${speed.value} fps`;
  }
  speed.addEventListener('input', () => {
    showSpeed();
    controls.onFpsChange?.(controls.fps);
  });
  playButton.addEventListener('click', () => controls.onPlayToggle?.());
  showSpeed();
  return controls;
}
