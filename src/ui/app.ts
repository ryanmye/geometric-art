// Wires the page together: the loaded photos, starting/pausing/resetting a
// run (or "Run all" over every photo), stats, compare and export. What a run
// does depends on the chosen style (overlapping shapes, triangle mesh or
// polygon mosaic) and output (single picture or seed animation); that lives
// in src/ui/runs/. The photo list itself is in src/ui/photos/.

import type { Bitmap } from '../engine/types';
import { isMaskPainted } from '../paint/mask';
import {
  decodePhotoFile,
  fetchImage,
  keptCopy,
  makeThumbnail,
  toWorkingBitmap,
  type DecodedPhoto,
  type DecoderPath,
} from './loadImage';
import { skipReason, skippedMessage } from './photos/skipReason';
import { setUpSettings, type Mode, type Settings } from './settings';
import { setUpStage } from './stage';
import { setUpStats } from './stats';
import { setUpImageInput } from './imageInput';
import { setUpLoopControls } from './loopControls';
import { createClock } from './clock';
import { download } from './download';
import { isMeshStyle, type ActiveRun, type RunContext } from './runs/activeRun';
import { createRun } from './runs/createRun';
import { pickVideoType } from './exports/recordVideo';
import { setUpDetail } from './detail';
import { formatBytes, setUpExportButtons } from './exportButtons';
import { loadSampleList, sampleName, sampleUrl, setUpSamplePicker, showSampleCredit, type SampleInfo } from './samples';
import { createPhotoList, type Photo } from './photos/photoList';
import { setUpPhotoStrip } from './photos/photoStrip';
import { createStoredRun } from './photos/storedRun';
import { batchSummary, planBatch, resultKey } from './photos/batchPlan';
import { createTaskQueue, fillRoom } from './photos/addQueue';
import { exportAllZip, type ExportAllFormat } from './photos/exportAll';
import { exportStems } from './photos/fileNames';
import { shareAllFiles } from './photos/shareAll';
import { setUpShareButton } from './shareButton';
import { SHARE_LIMITS } from './shareFiles';
import { differentSettingsNote } from './photos/storedResult';

/** What the page is doing; mirrored on document.body.dataset.state. */
type PageState = 'idle' | 'running' | 'paused' | 'done' | 'error';

/** Used if the list of samples cannot be loaded. */
const FALLBACK_SAMPLE_URL = 'samples/mona-lisa.jpg';

/** The most photos loaded at once (each keeps an image of up to 1024 px, at most about 4 MB). */
const MAX_PHOTOS = 40;

/** What the page keeps for each photo, besides what the photo list keeps. */
interface PhotoExtra {
  /** The photo, shrunk to at most KEPT_PHOTO_SIZE (1024 px) on its longest side. */
  image: ImageBitmap;
  thumbnail: HTMLCanvasElement;
  /** The sample's details, or null for the visitor's own photo. */
  credit: SampleInfo | null;
  /** Size of the photo as loaded, before it was shrunk. */
  originalSize: { width: number; height: number };
  /** Which decoder read the file (for checking from scripts). */
  decoder: DecoderPath;
}

/** Something to add: how to get its pixels, and what to call it. */
interface PhotoSource {
  name: string;
  credit: SampleInfo | null;
  /** Decode it; `onStatus` hears slow steps (e.g. downloading the HEIC decoder). */
  load(onStatus: (text: string) => void): Promise<DecodedPhoto>;
}

/** "1 photo", "3 photos". */
function photosText(count: number): string {
  return `${count} photo${count === 1 ? '' : 's'}`;
}

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
  const strip = setUpPhotoStrip({
    group: byId('photo-strip-group'),
    list: byId('photo-strip'),
    count: byId('photo-count'),
    removeButton: byId<HTMLButtonElement>('remove-photo'),
    clearButton: byId<HTMLButtonElement>('clear-photos'),
    clearConfirm: byId('clear-confirm'),
    clearQuestion: byId('clear-question'),
    clearYes: byId<HTMLButtonElement>('clear-yes'),
    clearCancel: byId<HTMLButtonElement>('clear-cancel'),
  });

  const startButton = byId<HTMLButtonElement>('start');
  const pauseButton = byId<HTMLButtonElement>('pause');
  const resetButton = byId<HTMLButtonElement>('reset');
  const compareButton = byId<HTMLButtonElement>('compare');
  const runAllButton = byId<HTMLButtonElement>('run-all');
  const redoFinished = byId<HTMLInputElement>('redo-finished');
  const batchControls = byId('batch-controls');
  const chooseButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-action="choose-file"]'));
  const sampleMenu = byId<HTMLDetailsElement>('sample-menu');
  const singleExports = byId('single-exports');
  const animationExports = byId('animation-exports');
  const exportButtonList = Array.from(document.querySelectorAll<HTMLButtonElement>('button[id^="export-"]'));
  const exportAll = byId('export-all');
  const exportAllHint = byId('export-all-hint');
  const exportStatus = byId('export-status');
  const runNote = byId('run-note');
  const photoName = byId('photo-name');
  const photoMessage = byId('photo-message');
  const errorBox = byId('error');
  const errorText = byId('error-text');

  const photos = createPhotoList<PhotoExtra>(MAX_PHOTOS);
  /** Each loaded photo's name for exported files (safe, and unique among the loaded photos). */
  function photoStems(): Map<number, string> {
    const stems = exportStems(photos.photos.map((photo) => photo.name));
    return new Map(photos.photos.map((photo, i) => [photo.id, stems[i]]));
  }
  let pageState: PageState = 'idle';
  /** The current photo at the chosen working size; the painted detail lines up with it. */
  let workingPhoto: Bitmap | null = null;
  /** The target of the latest run (for checking from scripts). */
  let target: Bitmap | null = null;
  /** Decimal weights used by the latest run (for checking from scripts). */
  let runWeights: Float32Array | null = null;
  let samples: SampleInfo[] = [];
  /** The current photo's run: a live one, or a stored result being shown. */
  let run: ActiveRun | null = null;
  /**
   * "Run all" in progress: the photos to run, where we are, any that failed
   * (with why), and whether we are between two photos (one finished, the
   * next not started yet; a Pause there holds the batch until Resume).
   */
  let batch: {
    ids: number[];
    index: number;
    skipped: number;
    failures: Array<{ name: string; reason: string }>;
    between: boolean;
  } | null = null;
  let exporting = false;
  let ticker: number | undefined;
  /**
   * Photos being added, one batch of files after another. A batch that fails
   * unexpectedly is reported and never stops the ones after it.
   */
  const addQueue = createTaskQueue((error) => {
    console.error(error);
    showError(`Adding photos failed: ${error instanceof Error ? error.message : String(error)}`);
  });
  /** The working size the current working image was made at (to undo a change made while running). */
  let appliedWorkingSize = settings.workingSize();

  const exportButtons = setUpExportButtons({
    getRun: () => run,
    // With several photos loaded, single exports start with the photo's name too.
    fileStem: () => (photos.photos.length > 1 && photos.current ? photoStems().get(photos.current.id)! : null),
    loop,
    status: exportStatus,
    onBusyChange: (busy) => {
      exporting = busy;
      updateExportButtons();
    },
    showError,
  });

  /** A run (or Run all) is in progress: settings, adding, removing and switching photos are locked. */
  function busy(): boolean {
    return pageState === 'running' || pageState === 'paused';
  }

  /**
   * Photos are being added. Until they are in, Start, Run all, Remove, Clear
   * and switching photos are locked (adding more files is fine: they queue).
   */
  function adding(): boolean {
    return addQueue.pending > 0;
  }

  /** Anything that may not change the photo list or start a run right now. */
  function locked(): boolean {
    return busy() || adding();
  }

  // ---- State and controls ----

  function setState(state: PageState): void {
    pageState = state;
    document.body.dataset.state = state;
    const running = busy();
    const hasPhoto = photos.current !== null;
    settings.setEnabled(!running);
    detail.setAvailable(hasPhoto && !running);
    startButton.disabled = !hasPhoto || locked();
    pauseButton.disabled = !running;
    pauseButton.textContent = state === 'paused' ? 'Resume' : 'Pause';
    resetButton.disabled = run === null && batch === null;
    compareButton.disabled = run === null;
    runAllButton.disabled = locked() || photos.photos.length < 2;
    redoFinished.disabled = running;
    for (const button of chooseButtons) button.disabled = running;
    if (state === 'running') {
      clock.start();
      clearInterval(ticker);
      ticker = window.setInterval(updateStats, 250);
    } else {
      clock.stop();
      clearInterval(ticker);
    }
    renderStrip();
    updateStats();
    updateExportButtons();
  }

  function renderStrip(): void {
    strip.render(photos.photos, photos.current?.id ?? null, locked());
    batchControls.hidden = photos.photos.length < 2;
  }

  function updateExportButtons(): void {
    // Which set of export buttons to show: the current run's output, or the chosen one.
    const output: Mode = run ? run.output : settings.mode();
    singleExports.hidden = output !== 'single';
    animationExports.hidden = output !== 'animation';
    const ready = run !== null && !exporting && (run.pictureExports() !== null || run.animationExports() !== null);
    for (const button of exportButtonList) button.disabled = !ready;
    // Export all: every photo with a finished result.
    const finished = photos.photos.filter((photo) => photo.status === 'done' && photo.result).length;
    exportAll.hidden = photos.photos.length < 2;
    exportAllHint.textContent = `${finished} of ${photos.photos.length} photos have a finished result.`;
    byId<HTMLButtonElement>('export-all-button').disabled = finished === 0 || exporting || locked();
    // Share all follows the same rules as Export all.
    byId<HTMLButtonElement>('export-all-share').disabled = finished === 0 || exporting || locked();
    if (shareAll) {
      const more = finished > SHARE_LIMITS.maxFiles ? '; more are saved as a zip instead' : '';
      exportAllHint.textContent += ` Share all sends PNGs (GIFs for animations), up to ${SHARE_LIMITS.maxFiles}${more}.`;
    }
    exportButtons.refreshShares();
    shareAll?.refresh();
  }

  function updateStats(): void {
    // A copy: a stored result's own stats must not change.
    const rows = run ? [...run.stats(clock.elapsedMs())] : null;
    // During Run all, say which photo is being made.
    if (rows && batch) {
      rows.unshift({ key: 'batch', label: 'Run all', value: `photo ${batch.index + 1} of ${batch.ids.length}` });
    }
    stats.show(rows);
    // A finished result on show says plainly if it was made as another style or output.
    const photo = photos.current;
    const shown = run && !busy() && photo?.status === 'done' ? photo.result : null;
    const differs = shown ? differentSettingsNote(shown, { style: settings.style(), output: settings.mode() }) : null;
    const note = [run?.note, differs].filter(Boolean).join(' ');
    runNote.textContent = note;
    runNote.hidden = note === '';
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

  /** A quiet message under the photo controls (adding progress, skipped files). */
  function photoNote(text: string): void {
    photoMessage.textContent = text;
    photoMessage.hidden = text === '';
  }

  // ---- The current photo ----

  /** Keep the current photo's painting with it before showing another photo. */
  function saveCurrentMask(): void {
    const photo = photos.current;
    const mask = detail.mask();
    if (!photo || !workingPhoto) return;
    photo.mask = mask && isMaskPainted(mask) ? mask.slice() : null;
    photo.maskSize = photo.mask ? { width: workingPhoto.width, height: workingPhoto.height } : null;
  }

  /**
   * Make a photo current and show it: its stored result if it has one, or
   * the photo itself. Its working-size image and painting are set up again.
   */
  function showPhoto(photo: Photo<PhotoExtra>): void {
    saveCurrentMask();
    stopRun();
    photos.select(photo.id);
    const { image, credit, originalSize } = photo.extra;
    if (credit) showSampleCredit(photoName, credit);
    else photoName.textContent = `${photo.name} (${originalSize.width} × ${originalSize.height})`;
    exportStatus.textContent = '';
    appliedWorkingSize = settings.workingSize();
    workingPhoto = toWorkingBitmap(image, appliedWorkingSize);
    detail.setImage(workingPhoto);
    if (photo.mask && photo.maskSize?.width === workingPhoto.width && photo.maskSize.height === workingPhoto.height) {
      detail.setMask(photo.mask);
    }
    if (photo.result && photo.status === 'done') {
      run = createStoredRun(photo.result, { stage, photo: image }, loop);
      run.start();
      setState('done');
    } else {
      stage.showPhoto(image);
      // A photo whose last run failed says why.
      if (photo.status === 'failed' && photo.error) showError(`${photo.name}: ${photo.error}`);
      setState('idle');
    }
  }

  /** The visitor picked a photo in the strip (ignored while running or adding). */
  strip.onSelect = (id) => {
    if (locked()) return;
    const photo = photos.find(id);
    if (photo) showPhoto(photo);
  };

  strip.onRemove = () => {
    const photo = photos.current;
    // Blocked while running or adding (a photo being added could be removed under it).
    if (locked() || !photo) return;
    stopRun();
    photos.remove(photo.id);
    photo.extra.image.close();
    // A note about the photos (e.g. "Run all finished: 3 photos made.") no longer applies.
    // Clear all (showNothing) and adding photos replace it already.
    photoNote('');
    const next = photos.current;
    if (next) {
      workingPhoto = null; // the removed photo's painting is not kept
      showPhoto(next);
    } else {
      showNothing();
    }
  };

  strip.onClear = () => {
    if (locked()) return;
    stopRun();
    showNothing();
    for (const photo of photos.clear()) photo.extra.image.close();
    setState('idle');
  };

  /** No photo loaded: the empty "drop a photo" state. */
  function showNothing(): void {
    workingPhoto = null;
    detail.setImage(null);
    stage.showEmpty();
    photoName.textContent = 'No photo loaded.';
    photoNote(''); // a note about photos that are gone no longer applies
    setState('idle');
  }

  // ---- Adding photos ----

  /**
   * Add photos one after another, so only one is held at full size at a
   * time; large photos are shrunk in a worker (see keptCopy).
   * Files are tried until the room under the cap is filled; files that
   * cannot be read are skipped and named in one message (they do not take up
   * room). The first new photo becomes current, if it is still loaded and no
   * run has started. While photos are being added, Start, Run all, Remove,
   * Clear and switching photos wait (see locked()).
   */
  function addPhotos(sources: PhotoSource[]): Promise<void> {
    const task = async () => {
      if (busy()) {
        photoNote('Photos cannot be added while a run is in progress. Wait for it to finish, or press Reset.');
        return;
      }
      setState(pageState); // show the add lock
      const skipped: Array<{ name: string; reason: string }> = [];
      const newPhotos: Photo<PhotoExtra>[] = [];
      const room = MAX_PHOTOS - photos.photos.length;
      const { notTried } = await fillRoom(sources, room, async (source, i) => {
        // e.g. "Adding photo 3 of 8…", then "Adding photo 3 of 8: decoding HEIC photo…"
        const counter = sources.length > 1 ? `Adding photo ${i + 1} of ${sources.length}` : 'Adding photo';
        photoNote(`${counter}…`);
        let decoded: DecodedPhoto;
        try {
          decoded = await source.load((status) => photoNote(`${counter}: ${status}…`));
        } catch (error) {
          skipped.push({ name: source.name, reason: skipReason(error) });
          return false;
        }
        // Measured now: keeping a smaller copy releases (closes) the decoded image.
        const originalSize = { width: decoded.bitmap.width, height: decoded.bitmap.height };
        let image: ImageBitmap | null = null;
        try {
          // Keep a copy of at most 1024 px; a larger decoded photo is released here.
          image = await keptCopy(decoded.bitmap);
          const extra: PhotoExtra = {
            image,
            thumbnail: makeThumbnail(image),
            credit: source.credit,
            originalSize,
            decoder: decoded.decoder,
          };
          newPhotos.push(...photos.add([{ name: source.name, extra }]).added);
          renderStrip();
          return true;
        } catch (error) {
          // Do not leak the decoded image (or its copy) if keeping it failed.
          decoded.bitmap.close();
          if (image && image !== decoded.bitmap) image.close();
          skipped.push({ name: source.name, reason: skipReason(error) });
          return false;
        }
      });
      const messages: string[] = [];
      if (skipped.length > 0) messages.push(skippedMessage(skipped));
      if (notTried.length > 0) {
        messages.push(`You can load up to ${MAX_PHOTOS} photos at once; ${notTried.length} were not added.`);
      }
      photoNote(messages.join(' '));
      // Show the first new photo, if it is still loaded and nothing is running.
      const firstNew = newPhotos[0];
      if (firstNew && !busy() && photos.find(firstNew.id)) {
        hideError();
        showPhoto(firstNew);
      }
    };
    // When this batch (and any before it) is done, refresh the locks.
    return addQueue.run(task).then(() => setState(pageState));
  }

  setUpImageInput({
    fileInput: byId<HTMLInputElement>('file-input'),
    chooseButtons,
    dropOverlay: byId('drop-overlay'),
    onFiles: (files) =>
      void addPhotos(
        files.map((file) => ({
          name: file.name || 'Pasted image',
          credit: null,
          load: (onStatus) => decodePhotoFile(file, onStatus),
        })),
      ),
  });

  /** The source for a sample by its short name (e.g. "great-wave"); the first one if not found. */
  function sampleSource(name?: string): PhotoSource {
    const sample = samples.find((s) => sampleName(s) === name) ?? samples[0];
    const browserDecoded = async (url: string): Promise<DecodedPhoto> => ({ bitmap: await fetchImage(url), decoder: 'browser' });
    if (!sample) return { name: 'Mona Lisa (sample)', credit: null, load: () => browserDecoded(FALLBACK_SAMPLE_URL) };
    return { name: sample.title, credit: sample, load: () => browserDecoded(sampleUrl(sample)) };
  }
  for (const button of document.querySelectorAll('[data-action="try-sample"]')) {
    button.addEventListener('click', () => void addPhotos([sampleSource()]));
  }
  const samplesReady = loadSampleList()
    .then((list) => {
      samples = list;
      setUpSamplePicker(sampleMenu, byId('sample-grid'), list, (sample) => {
        void addPhotos([sampleSource(sampleName(sample))]);
      });
    })
    .catch((error) => showError(error instanceof Error ? error.message : String(error)));

  /**
   * A new working size: remake the current photo's working image. Painted
   * detail belongs to one working size, so every photo's painting is cleared
   * (as it always has been for the one photo). Stored results stay: they are
   * still valid pictures of their photos until rerun.
   */
  function changeWorkingSize(): void {
    const select = byId<HTMLFormElement>('settings').elements.namedItem('workingSize') as HTMLSelectElement;
    // While a run is in progress the menu is disabled; a scripted change is put back.
    if (busy()) {
      select.value = String(appliedWorkingSize);
      return;
    }
    appliedWorkingSize = settings.workingSize();
    for (const photo of photos.photos) {
      photo.mask = null;
      photo.maskSize = null;
    }
    const photo = photos.current;
    workingPhoto = photo ? toWorkingBitmap(photo.extra.image, settings.workingSize()) : null;
    detail.setImage(workingPhoto);
  }
  (byId<HTMLFormElement>('settings').elements.namedItem('workingSize') as HTMLSelectElement).addEventListener(
    'change',
    changeWorkingSize,
  );

  // ---- Running ----

  function stopRun(): void {
    run?.dispose();
    run = null;
    target = null;
    runWeights = null;
    clock.reset();
  }

  /** The settings a result depends on, for the "skip finished photos" rule. */
  function keyFor(chosen: Settings, mask: Uint8Array | null): string {
    const shapes = chosen.style === 'shapes';
    return resultKey(
      {
        style: chosen.style,
        output: chosen.mode,
        config: shapes ? chosen.config : chosen.meshConfig,
        animation: chosen.mode === 'animation' ? (shapes ? chosen.animation : chosen.meshAnimation) : null,
        workingSize: chosen.workingSize,
        detail: chosen.detail,
      },
      mask,
    );
  }

  /** Run the current photo with the current settings (Start, and each photo of Run all). */
  function startRun(): void {
    const photo = photos.current;
    if (!photo) return;
    const image = photo.extra.image;
    stopRun();
    hideError();
    exportStatus.textContent = '';
    try {
      const chosen = settings.read();
      // The working-size photo made when the photo or size was chosen (same pixels).
      target = workingPhoto ?? toWorkingBitmap(image, chosen.workingSize);
      const executor = params.get('executor') === 'inline' ? 'inline' : undefined;
      const workers = Number(params.get('workers')) || undefined;
      const weighting = detail.weightsFor(target);
      runWeights = weighting ? weighting.weights : null;
      const liveMask = detail.mask();
      const key = keyFor(chosen, liveMask && isMaskPainted(liveMask) ? liveMask : null);
      let thisRun: ActiveRun | null = null;
      const context: RunContext = {
        stage,
        photo: image,
        target,
        runnerOptions: { executor, workerCount: workers, ...weighting },
        onProgress: () => {
          if (run !== thisRun) return;
          updateStats();
          updateExportButtons();
        },
        onDone: () => {
          if (run !== thisRun || !thisRun) return;
          // Keep the result with its photo, so switching back shows it again.
          photo.result = {
            style: thisRun.style,
            output: thisRun.output,
            key,
            snapshot: thisRun.snapshot(),
            stats: thisRun.stats(clock.elapsedMs()),
            note: thisRun.note ?? null,
          };
          photo.status = 'done';
          finishedOne();
        },
        onError: (error) => {
          if (run === thisRun) runFailed(photo, error);
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
      photo.status = 'running';
      photo.error = null;
      setState('running');
      thisRun.start();
    } catch (error) {
      runFailed(photo, error);
    }
  }

  /**
   * A photo's run failed. Its partial run is thrown away (so it can never be
   * shown or exported as if finished, and its workers are released) and the
   * photo is marked failed with the reason. Run all notes it and goes on.
   */
  function runFailed(photo: Photo<PhotoExtra>, error: unknown): void {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(error);
    photo.status = 'failed';
    photo.error = reason;
    photo.result = null;
    stopRun();
    stage.showPhoto(photo.extra.image);
    if (batch) {
      batch.failures.push({ name: photo.name, reason });
      finishedOne();
    } else {
      fail(new Error(`${photo.name}: ${reason}`));
    }
  }

  /** The current photo's run ended (done or failed): next photo of Run all, or done. */
  function finishedOne(): void {
    if (!batch) {
      setState('done');
      return;
    }
    batch.index++;
    batch.between = true;
    // On a fresh turn of the event loop, so the finished run has wound down.
    setTimeout(runNextInBatch, 0);
  }

  // ---- Run all ----

  /** Run every photo in turn with the current settings, skipping finished ones (see batchPlan.ts). */
  function runAll(): void {
    if (locked() || photos.photos.length === 0) return;
    saveCurrentMask();
    const chosen = settings.read();
    const plan = planBatch(
      photos.photos.map((photo) => ({
        id: photo.id,
        resultKey: photo.status === 'done' && photo.result ? photo.result.key : null,
        keyNow: keyFor(chosen, photo.mask),
      })),
      redoFinished.checked,
    );
    if (plan.run.length === 0) {
      photoNote('Every photo already has a result made with these settings. Tick "Also redo finished photos" to run them again.');
      return;
    }
    photoNote(plan.skipped.length > 0 ? `Skipping ${photosText(plan.skipped.length)} already finished with these settings.` : '');
    batch = { ids: plan.run, index: 0, skipped: plan.skipped.length, failures: [], between: true };
    runNextInBatch();
  }

  /** Start the batch's next photo, or finish the batch. Does nothing unless between photos. */
  function runNextInBatch(): void {
    if (!batch || !batch.between) return;
    if (batch.index >= batch.ids.length) {
      const { ids, skipped, failures } = batch;
      batch = null;
      // Show the photo we ended on as it now is: its finished result, or
      // (if it failed) the photo with its reason. This also releases the
      // last run's workers.
      const current = photos.current;
      if (current) showPhoto(current);
      photoNote(batchSummary(ids.length - failures.length, skipped, failures));
      return;
    }
    // Paused between photos: hold here; Resume calls this again.
    if (pageState === 'paused') return;
    const photo = photos.find(batch.ids[batch.index]);
    if (!photo) {
      // Cannot happen while locked, but never get stuck.
      batch.index++;
      runNextInBatch();
      return;
    }
    // Exactly what Start does for this photo on its own: show it (with its own
    // painting), then run it. So a batch result equals the solo result.
    batch.between = false;
    showPhoto(photo);
    startRun();
  }

  startButton.addEventListener('click', () => {
    if (!locked()) startRun();
  });
  runAllButton.addEventListener('click', runAll);

  pauseButton.addEventListener('click', () => {
    // Between two photos of Run all there is no live run to pause: the
    // batch holds before the next photo instead (see runNextInBatch).
    const betweenPhotos = batch?.between ?? false;
    if (pageState === 'running') {
      if (!betweenPhotos) run?.pause();
      setState('paused');
    } else if (pageState === 'paused') {
      setState('running');
      if (betweenPhotos) runNextInBatch();
      else run?.resume();
    }
  });

  /** Reset: stop any run (and Run all); the current photo goes back to having no result. */
  resetButton.addEventListener('click', () => {
    const stoppedBatch = batch !== null;
    batch = null;
    stopRun();
    hideError();
    exportStatus.textContent = '';
    const photo = photos.current;
    if (photo) {
      photo.status = 'none';
      photo.result = null;
      stage.showPhoto(photo.extra.image);
    } else {
      stage.showEmpty();
    }
    if (stoppedBatch) photoNote('Run all stopped.');
    setState('idle');
  });

  // Switching output changes which export buttons show (when no run is shown).
  for (const radio of document.querySelectorAll('input[name="mode"]')) {
    radio.addEventListener('change', updateExportButtons);
  }
  // Switching style changes which export buttons apply when no run is shown.
  settings.onStyleChange = () => updateExportButtons();
  // A shown result's note says if it no longer matches the chosen style or output.
  byId('settings').addEventListener('change', updateStats);

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
  // From the keyboard: hold Space or Enter on the button. Only a comparison
  // started this way ends when the button loses focus (pressing the picture
  // moves focus away, and must not end the comparison it just started).
  let comparingByKey = false;
  compareButton.addEventListener('keydown', (event) => {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      comparingByKey = true;
      stage.setComparing(true);
    }
  });
  for (const type of ['keyup', 'blur']) {
    compareButton.addEventListener(type, () => {
      if (!comparingByKey) return;
      comparingByKey = false;
      stage.setComparing(false);
    });
  }

  // ---- Export all ----

  /** Every photo with a finished result, with the name its files get. */
  function finishedItems() {
    const stems = photoStems();
    return photos.photos
      .filter((photo) => photo.status === 'done' && photo.result)
      .map((photo) => ({ stem: stems.get(photo.id)!, stored: photo.result! }));
  }

  byId('export-all-button').addEventListener('click', () =>
    exportButtons.task('Export all', async () => {
      if (busy()) return;
      const items = finishedItems();
      const format = byId<HTMLSelectElement>('export-all-format').value as ExportAllFormat;
      const file = await exportAllZip(items, {
        format,
        pngSize: Number(byId<HTMLSelectElement>('export-size').value),
        gifSize: Number(byId<HTMLSelectElement>('gif-size').value),
        fps: loop.fps,
        onProgress: (text) => {
          exportStatus.textContent = `Export all: ${text}`;
        },
      });
      download(file.name, file.blob);
      exportStatus.textContent = `Saved ${file.name}: ${photosText(file.count)}, ${formatBytes(file.blob.size)}.`;
    }),
  );

  // Share all: the finished pictures as PNGs (GIFs for animations) in one
  // share, where the browser can share files (see photos/shareAll.ts).
  const exportSizes = () => ({
    pngSize: Number(byId<HTMLSelectElement>('export-size').value),
    gifSize: Number(byId<HTMLSelectElement>('gif-size').value),
    fps: loop.fps,
  });
  const shareAll = setUpShareButton(byId<HTMLButtonElement>('export-all-share'), {
    what: 'all',
    type: 'image/png',
    key: () => [...finishedItems().flatMap((item) => [item.stem, item.stored]), ...Object.values(exportSizes())],
    prepare: () =>
      exportButtons.whileBusy(async () => {
        if (busy()) return null;
        const options = {
          ...exportSizes(),
          onProgress: (text: string) => {
            exportStatus.textContent = `Share all: ${text}`;
          },
        };
        return shareAllFiles(finishedItems(), options, download, (text) => {
          exportStatus.textContent = text;
        });
      }),
    status: exportStatus,
    showError,
  });

  // ---- Anything unexpected is shown on the page too ----

  window.addEventListener('error', (event) => showError(event.message));
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    showError(reason instanceof Error ? reason.message : String(reason));
  });

  // A small hook for checking the page from scripts (headless browser tests).
  (window as unknown as { geometricArt: object }).geometricArt = {
    // The shapes single picture and animation, when that is what is shown.
    result: () => (run && run.style === 'shapes' && run.output === 'single' ? run.snapshot() : null),
    animation: () => (run && run.style === 'shapes' && run.output === 'animation' ? run.snapshot() : null),
    // Triangle mesh or polygon mosaic (both from the mesh engine).
    mesh: () => (run && isMeshStyle(run.style) && run.output === 'single' ? run.snapshot() : null),
    meshAnimation: () => (run && isMeshStyle(run.style) && run.output === 'animation' ? run.snapshot() : null),
    // Every loaded photo, with its stored result.
    photos: () =>
      photos.photos.map((photo) => ({
        id: photo.id,
        name: photo.name,
        status: photo.status,
        current: photo.id === photos.current?.id,
        masked: photo.mask !== null,
        decoder: photo.extra.decoder,
        originalSize: photo.extra.originalSize,
        result: photo.result
          ? { style: photo.result.style, output: photo.result.output, key: photo.result.key, snapshot: photo.result.snapshot }
          : null,
      })),
    batch: () => (batch ? { index: batch.index, total: batch.ids.length } : null),
    lastGif: () => exportButtons.lastGif(),
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
  // &samples=a,b,c (several samples) and &runall (Run all instead of Start)
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
    const names = value('samples') ? (value('samples') as string).split(',') : [value('sample') ?? undefined];
    void samplesReady
      .then(() => addPhotos(names.map((name) => sampleSource(name))))
      .then(() => {
        if (!photos.current) return;
        // Start from the first photo, then Start (or Run all).
        showPhoto(photos.photos[0]);
        if (params.has('runall')) runAll();
        else startRun();
      });
  }
}
