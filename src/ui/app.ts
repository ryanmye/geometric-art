// Wires the page together: loading a photo, starting/pausing/resetting a run,
// stats, compare and export. What a run does depends on the chosen style
// (overlapping shapes, triangle mesh or polygon mosaic) and output (single
// picture or seed animation); that lives in src/ui/runs/.

import type { Bitmap } from '../engine/types';
import { decodeImage, fetchImage, toWorkingBitmap } from './loadImage';
import { setUpSettings, type Mode } from './settings';
import { setUpStage } from './stage';
import { setUpStats } from './stats';
import { setUpImageInput } from './imageInput';
import { setUpLoopControls } from './loopControls';
import { createClock } from './clock';
import { download } from './download';
import { isMeshStyle, type ActiveRun, type RunContext } from './runs/activeRun';
import { createRun } from './runs/createRun';
import { animationGif, animationVideo, gifTiming, pngFramesZip } from './exports/animationFiles';
import { pictureJSON, picturePNG, pictureSVG } from './exports/pictureFiles';
import { pickVideoType } from './exports/recordVideo';
import { setUpDetail } from './detail';
import { loadSampleList, sampleName, sampleUrl, setUpSamplePicker, showSampleCredit, type SampleInfo } from './samples';

/** What the page is doing; mirrored on document.body.dataset.state. */
type PageState = 'idle' | 'running' | 'paused' | 'done' | 'error';

/** Used if the list of samples cannot be loaded. */
const FALLBACK_SAMPLE_URL = 'samples/mona-lisa.jpg';

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}

export function startApp(): void {
  const params = new URLSearchParams(location.search);
  const settings = setUpSettings(byId<HTMLFormElement>('settings'));
  const stats = setUpStats(byId('stats'));
  const stage = setUpStage({
    stage: byId('stage'),
    frame: byId('frame'),
    empty: byId('empty'),
    picture: byId<HTMLCanvasElement>('picture'),
    original: byId<HTMLCanvasElement>('original'),
    label: byId('frame-label'),
  });
  const loop = setUpLoopControls({
    group: byId('loop-group'),
    preview: byId<HTMLCanvasElement>('loop-preview'),
    hint: byId('loop-hint'),
    playButton: byId<HTMLButtonElement>('loop-play'),
    speed: byId<HTMLInputElement>('loop-speed'),
    speedOut: byId<HTMLOutputElement>('loop-speed-out'),
  });
  const clock = createClock();
  const detail = setUpDetail({
    host: byId('frame'),
    strength: byId<HTMLFormElement>('settings').elements.namedItem('detail') as HTMLInputElement,
    mapView: byId<HTMLCanvasElement>('importance-view'),
    mapButton: byId<HTMLButtonElement>('show-importance'),
    paintButton: byId<HTMLButtonElement>('paint-detail'),
    tools: byId('paint-tools'),
    eraseRadios: Array.from(document.querySelectorAll<HTMLInputElement>('input[name="brushMode"]')),
    brushSize: byId<HTMLInputElement>('brush-size'),
    clearButton: byId<HTMLButtonElement>('clear-mask'),
    hint: byId('detail-hint'),
  });
  // While painting, show the original photo under the brush (also over a finished picture).
  detail.onPaintingChange = (painting) => stage.setComparing(painting);

  const startButton = byId<HTMLButtonElement>('start');
  const pauseButton = byId<HTMLButtonElement>('pause');
  const resetButton = byId<HTMLButtonElement>('reset');
  const compareButton = byId<HTMLButtonElement>('compare');
  const singleExports = byId('single-exports');
  const animationExports = byId('animation-exports');
  const exportButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('button[id^="export-"]'));
  const exportSize = byId<HTMLSelectElement>('export-size');
  const exportStatus = byId('export-status');
  const runNote = byId('run-note');
  const photoName = byId('photo-name');
  const errorBox = byId('error');
  const errorText = byId('error-text');

  let pageState: PageState = 'idle';
  let photo: ImageBitmap | null = null;
  /** The photo at the chosen working size; the painted detail lines up with it. */
  let workingPhoto: Bitmap | null = null;
  let target: Bitmap | null = null;
  /** Decimal weights used by the current run (for checking from scripts). */
  let runWeights: Float32Array | null = null;
  let samples: SampleInfo[] = [];
  let run: ActiveRun | null = null;
  let exporting = false;
  /** Size and encoding time of the last GIF, for checking from scripts. */
  let lastGif: { name: string; bytes: number; encodeMs: number } | null = null;
  let ticker: number | undefined;

  // ---- State and controls ----

  function setState(state: PageState): void {
    pageState = state;
    document.body.dataset.state = state;
    const busy = state === 'running' || state === 'paused';
    settings.setEnabled(!busy);
    detail.setAvailable(photo !== null && !busy);
    startButton.disabled = !photo || busy;
    pauseButton.disabled = !busy;
    pauseButton.textContent = state === 'paused' ? 'Resume' : 'Pause';
    resetButton.disabled = run === null;
    compareButton.disabled = run === null;
    if (state === 'running') {
      clock.start();
      clearInterval(ticker);
      ticker = window.setInterval(updateStats, 250);
    } else {
      clock.stop();
      clearInterval(ticker);
    }
    updateStats();
    updateExportButtons();
  }

  function updateExportButtons(): void {
    // Which set of export buttons to show: the current run's output, or the chosen one.
    const output: Mode = run ? run.output : settings.mode();
    singleExports.hidden = output !== 'single';
    animationExports.hidden = output !== 'animation';
    const ready = run !== null && !exporting && (run.pictureExports() !== null || run.animationExports() !== null);
    for (const button of exportButtons) button.disabled = !ready;
  }

  function updateStats(): void {
    stats.show(run ? run.stats(clock.elapsedMs()) : null);
    const note = run?.note ?? null;
    runNote.textContent = note ?? '';
    runNote.hidden = note === null;
  }

  function showError(message: string): void {
    errorText.textContent = message;
    errorBox.hidden = false;
  }

  function hideError(): void {
    errorBox.hidden = true;
  }

  function fail(error: unknown): void {
    console.error(error);
    showError(error instanceof Error ? error.message : String(error));
    setState('error');
  }

  // ---- Loading a photo ----

  /** Load a photo; `credit` is a sample's details or a file name. */
  async function loadPhoto(load: () => Promise<ImageBitmap>, credit: SampleInfo | string): Promise<boolean> {
    try {
      const bitmap = await load();
      stopRun();
      photo = bitmap;
      if (typeof credit === 'string') photoName.textContent = `${credit} (${bitmap.width} × ${bitmap.height})`;
      else showSampleCredit(photoName, credit);
      hideError();
      stage.showPhoto(bitmap);
      updateWorkingPhoto();
      setState('idle');
      return true;
    } catch (error) {
      if (!photo) stage.showEmpty();
      fail(error);
      return false;
    }
  }

  setUpImageInput({
    fileInput: byId<HTMLInputElement>('file-input'),
    chooseButtons: Array.from(document.querySelectorAll<HTMLElement>('[data-action="choose-file"]')),
    dropOverlay: byId('drop-overlay'),
    onFile: (file) => void loadPhoto(() => decodeImage(file), file.name || 'Pasted image'),
  });

  /** Load a sample by its short name (e.g. "great-wave"); the first one if not found. */
  function loadSample(name?: string): Promise<boolean> {
    const sample = samples.find((s) => sampleName(s) === name) ?? samples[0];
    if (!sample) return loadPhoto(() => fetchImage(FALLBACK_SAMPLE_URL), 'Mona Lisa (sample)');
    return loadPhoto(() => fetchImage(sampleUrl(sample)), sample);
  }
  for (const button of document.querySelectorAll('[data-action="try-sample"]')) {
    button.addEventListener('click', () => void loadSample());
  }
  const samplesReady = loadSampleList()
    .then((list) => {
      samples = list;
      setUpSamplePicker(byId<HTMLDetailsElement>('sample-menu'), byId('sample-grid'), list, (sample) => {
        void loadPhoto(() => fetchImage(sampleUrl(sample)), sample);
      });
    })
    .catch((error) => showError(error instanceof Error ? error.message : String(error)));

  /**
   * Make the working-size copy of the photo, which the painted detail lines
   * up with. A new photo or working size starts a fresh painting.
   */
  function updateWorkingPhoto(): void {
    workingPhoto = photo ? toWorkingBitmap(photo, settings.workingSize()) : null;
    detail.setImage(workingPhoto);
  }
  (byId<HTMLFormElement>('settings').elements.namedItem('workingSize') as HTMLSelectElement).addEventListener(
    'change',
    updateWorkingPhoto,
  );

  // ---- Running ----

  function stopRun(): void {
    run?.dispose();
    run = null;
    target = null;
    clock.reset();
  }

  function startRun(): void {
    if (!photo) return;
    const currentPhoto = photo;
    stopRun();
    hideError();
    exportStatus.textContent = '';
    try {
      const chosen = settings.read();
      // The working-size photo made when the photo or size was chosen (same pixels).
      target = workingPhoto ?? toWorkingBitmap(currentPhoto, chosen.workingSize);
      const executor = params.get('executor') === 'inline' ? 'inline' : undefined;
      const workers = Number(params.get('workers')) || undefined;
      const weighting = detail.weightsFor(target);
      runWeights = weighting ? weighting.weights : null;
      let thisRun: ActiveRun | null = null;
      const context: RunContext = {
        stage,
        photo: currentPhoto,
        target,
        runnerOptions: { executor, workerCount: workers, ...weighting },
        onProgress: () => {
          if (run !== thisRun) return;
          updateStats();
          updateExportButtons();
        },
        onDone: () => {
          if (run === thisRun) setState('done');
        },
        onError: (error) => {
          if (run === thisRun) fail(error);
        },
      };
      thisRun = createRun(
        {
          style: chosen.style,
          output: chosen.mode,
          config: chosen.config,
          meshConfig: chosen.meshConfig,
          animation: chosen.animation,
          meshAnimation: chosen.meshAnimation,
        },
        context,
        loop,
      );
      run = thisRun;
      setState('running');
      thisRun.start();
    } catch (error) {
      fail(error);
    }
  }

  startButton.addEventListener('click', startRun);

  pauseButton.addEventListener('click', () => {
    if (!run) return;
    if (pageState === 'running') {
      run.pause();
      setState('paused');
    } else if (pageState === 'paused') {
      setState('running');
      run.resume();
    }
  });

  resetButton.addEventListener('click', () => {
    stopRun();
    hideError();
    exportStatus.textContent = '';
    if (photo) stage.showPhoto(photo);
    else stage.showEmpty();
    setState('idle');
  });

  // Switching output changes which export buttons show (when no run is shown).
  for (const radio of document.querySelectorAll('input[name="mode"]')) {
    radio.addEventListener('change', updateExportButtons);
  }
  // Switching style changes which export buttons apply when no run is shown.
  settings.onStyleChange = () => updateExportButtons();

  byId('error-close').addEventListener('click', hideError);

  // ---- Compare with the original: hold the button, or press on the picture ----

  function holdToCompare(element: HTMLElement): void {
    element.addEventListener('pointerdown', (event) => {
      if (!run || detail.painting) return;
      stage.setComparing(true);
      try {
        // Keep receiving pointerup even if the pointer slides off the element.
        element.setPointerCapture(event.pointerId);
      } catch {
        // Not essential; pointerup on the element still ends the comparison.
      }
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      element.addEventListener(type, () => {
        if (!detail.painting) stage.setComparing(false);
      });
    }
  }
  holdToCompare(compareButton);
  holdToCompare(byId('frame'));
  compareButton.addEventListener('keydown', (event) => {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      stage.setComparing(true);
    }
  });
  compareButton.addEventListener('keyup', () => stage.setComparing(false));
  compareButton.addEventListener('blur', () => stage.setComparing(false));

  // ---- Export: single picture (any style) ----

  byId('export-svg').addEventListener('click', () => {
    const picture = run?.pictureExports();
    if (!picture) return;
    const file = pictureSVG(picture);
    download(file.name, file.blob);
  });

  byId('export-json').addEventListener('click', () => {
    const picture = run?.pictureExports();
    if (!picture) return;
    const file = pictureJSON(picture);
    download(file.name, file.blob);
  });

  byId('export-png').addEventListener('click', () =>
    exportTask('PNG', async () => {
      const picture = run?.pictureExports();
      if (!picture) return;
      const file = await picturePNG(picture, Number(exportSize.value));
      download(file.name, file.blob);
    }),
  );

  // ---- Export: animation (any style) ----

  byId('export-anim-svg').addEventListener('click', () => {
    const animation = run?.animationExports();
    if (!animation) return;
    download(`${animation.baseName}.svg`, new Blob([animation.animatedSVG(loop.fps)], { type: 'image/svg+xml' }));
  });

  byId('export-anim-json').addEventListener('click', () => {
    const animation = run?.animationExports();
    if (!animation) return;
    download(`${animation.baseName}.json`, new Blob([animation.json(loop.fps)], { type: 'application/json' }));
  });

  byId('export-anim-zip').addEventListener('click', () =>
    exportTask('PNG frames', async () => {
      const animation = run?.animationExports();
      if (!animation) return;
      const size = Number(exportSize.value);
      const file = await pngFramesZip(animation, size, (done, total) => {
        exportStatus.textContent = `Rendering PNG frames… ${done} of ${total}`;
      });
      download(file.name, file.blob);
      exportStatus.textContent = `Saved ${file.name} (${formatBytes(file.blob.size)}).`;
    }),
  );

  byId('export-anim-video').addEventListener('click', () =>
    exportTask('Video', async () => {
      const animation = run?.animationExports();
      if (!animation) return;
      if (!pickVideoType()) {
        exportStatus.textContent =
          'This browser cannot record video. Try Chrome, Edge or Firefox, or export PNG frames instead.';
        return;
      }
      const loops = Math.max(1, Math.min(20, Math.round(Number(byId<HTMLInputElement>('video-loops').value)) || 4));
      const file = await animationVideo(animation, {
        fps: loop.fps,
        loops,
        size: Number(byId<HTMLSelectElement>('video-size').value),
        onProgress: (done, total) => {
          exportStatus.textContent = `Recording video… ${done.toFixed(1)} of ${total.toFixed(1)} s (keep this tab visible)`;
        },
      });
      download(file.name, file.blob);
      exportStatus.textContent = `Saved ${file.name} (${file.mimeType}, ${formatBytes(file.blob.size)}).`;
    }),
  );

  byId('export-anim-gif').addEventListener('click', () =>
    exportTask('GIF', async () => {
      const animation = run?.animationExports();
      if (!animation) return;
      const fps = loop.fps;
      const file = await animationGif(animation, {
        fps,
        size: Number(byId<HTMLSelectElement>('gif-size').value),
        onProgress: (message) => {
          exportStatus.textContent = message;
        },
      });
      download(file.name, file.blob);
      lastGif = { name: file.name, bytes: file.blob.size, encodeMs: Math.round(file.encodeMs) };
      // GIF timing is in hundredths of a second, so some speeds cannot be kept exactly.
      const timing = gifTiming(fps);
      const speedNote = timing.rounded
        ? ` GIF stores frame times in hundredths of a second, so it plays at ${timing.actualFps.toFixed(2)} fps instead of ${fps}.`
        : '';
      exportStatus.textContent = `Saved ${file.name} (${formatBytes(file.blob.size)}).${speedNote}`;
    }),
  );

  /** Run a slow export with the export buttons disabled and errors shown on the page. */
  async function exportTask(label: string, task: () => Promise<void>): Promise<void> {
    exporting = true;
    updateExportButtons();
    try {
      await task();
    } catch (error) {
      exportStatus.textContent = '';
      showError(`${label} export failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      exporting = false;
      updateExportButtons();
    }
  }

  // ---- Anything unexpected is shown on the page too ----

  window.addEventListener('error', (event) => showError(event.message));
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    showError(reason instanceof Error ? reason.message : String(reason));
  });

  // A small hook for checking the page from scripts (headless browser tests).
  (window as unknown as { geometricArt: object }).geometricArt = {
    // The shapes single picture and animation, when that is what is running.
    result: () => (run && run.style === 'shapes' && run.output === 'single' ? run.snapshot() : null),
    animation: () => (run && run.style === 'shapes' && run.output === 'animation' ? run.snapshot() : null),
    // Triangle mesh or polygon mosaic (both from the mesh engine).
    mesh: () => (run && isMeshStyle(run.style) && run.output === 'single' ? run.snapshot() : null),
    meshAnimation: () => (run && isMeshStyle(run.style) && run.output === 'animation' ? run.snapshot() : null),
    lastGif: () => lastGif,
    target: () => target,
    weights: () => (runWeights ? Array.from(runWeights) : null),
    mask: () => {
      const mask = detail.mask();
      return mask ? Array.from(mask) : null;
    },
    videoType: () => pickVideoType(),
  };

  setState('idle');

  // ?demo loads a sample and starts straight away. Optional extras:
  // &sample=great-wave (file name without extension; default the first, Mona Lisa)
  // &shapes=N &seed=S &types=triangle,ellipse &quality=draft|standard|fine &size=128|256|512
  // &importance=0..1 (detail focus) &frames=N (seed animation with N frames) &shared=K &fps=F
  // &style=mesh (triangle mesh) or &style=polygons (polygon mosaic), with
  // &points=N &variation=0..1 (for a seed animation)
  // (and, for checking the engine, &executor=inline or &workers=N).
  if (params.has('demo')) {
    const value = (name: string) => params.get(name);
    if (value('shapes')) settings.setShapeCount(Number(value('shapes')));
    if (value('seed')) settings.setSeed(Number(value('seed')));
    if (value('types')) settings.setShapeTypes((value('types') as string).split(','));
    if (value('quality')) settings.setQuality(value('quality') as string);
    if (value('size')) settings.setWorkingSize(Number(value('size')));
    const style = value('style');
    if (style === 'mesh' || style === 'polygons') settings.setStyle(style);
    if (value('points')) settings.setPoints(Number(value('points')));
    if (value('variation') !== null) settings.setVariation(Number(value('variation')));
    if (value('importance') !== null) {
      try {
        settings.setDetail(value('importance') as string);
      } catch (error) {
        showError(error instanceof Error ? error.message : String(error));
      }
    }
    if (value('frames')) {
      settings.setMode('animation');
      settings.setFrames(Number(value('frames')));
    }
    if (value('shared')) settings.setShared(Number(value('shared')));
    if (value('fps')) loop.setFps(Number(value('fps')));
    void samplesReady
      .then(() => loadSample(value('sample') ?? undefined))
      .then((loaded) => {
        if (loaded) startRun();
      });
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
