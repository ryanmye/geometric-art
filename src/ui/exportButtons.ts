// The export buttons for the current photo's result: SVG, PNG and JSON for a
// picture; animated SVG, JSON, PNG frames, video and GIF for an animation.
// Where the browser can share files, also "Share ..." buttons for the PNG,
// GIF and video, which open the share sheet (on an iPhone: Save to Photos).
// (Export all, for every photo at once, is in photos/exportAll.ts.)

import type { ActiveRun } from './runs/activeRun';
import type { LoopControls } from './loopControls';
import { download as saveFile } from './download';
import { animationGif, animationVideo, gifTiming, pngFramesZip } from './exports/animationFiles';
import { pictureJSON, picturePNG, pictureSVG } from './exports/pictureFiles';
import { pickVideoType } from './exports/recordVideo';
import { setUpShareButton } from './shareButton';
import { shareableFile } from './shareFiles';

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export interface ExportButtons {
  /** Size and encoding time of the last GIF, for checking from scripts. */
  lastGif(): { name: string; bytes: number; encodeMs: number } | null;
  /**
   * Run a slow export with the export buttons disabled and errors shown on
   * the page (also used by Export all).
   */
  task(label: string, work: () => Promise<void>): Promise<void>;
  /** Run slow work with the export buttons disabled, passing its result or error on (used for sharing). */
  whileBusy<T>(work: () => Promise<T>): Promise<T>;
  /** Forget files made for sharing if the result or a setting has changed since. */
  refreshShares(): void;
}

export function setUpExportButtons(deps: {
  getRun(): ActiveRun | null;
  /** Put in front of every file name (the photo's name when several are loaded), or null. */
  fileStem(): string | null;
  loop: LoopControls;
  status: HTMLElement;
  /** Called when an export starts or ends, so the page can enable or disable the buttons. */
  onBusyChange(busy: boolean): void;
  showError(message: string): void;
}): ExportButtons {
  const { getRun, loop, status } = deps;
  const exportSize = byId<HTMLSelectElement>('export-size');
  let lastGif: { name: string; bytes: number; encodeMs: number } | null = null;

  /** A file's name, with the photo's name in front if there is a stem. */
  function fileName(name: string): string {
    const stem = deps.fileStem();
    return stem ? `${stem}-${name}` : name;
  }

  /** Save a file, named after the photo too if there is a stem; returns the name used. */
  function download(name: string, blob: Blob): string {
    const saved = fileName(name);
    saveFile(saved, blob);
    return saved;
  }

  async function task(label: string, work: () => Promise<void>): Promise<void> {
    deps.onBusyChange(true);
    try {
      await work();
    } catch (error) {
      status.textContent = '';
      deps.showError(`${label} export failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      deps.onBusyChange(false);
    }
  }

  // ---- Single picture (any style) ----

  byId('export-svg').addEventListener('click', () => {
    const picture = getRun()?.pictureExports();
    if (!picture) return;
    const file = pictureSVG(picture);
    download(file.name, file.blob);
  });

  byId('export-json').addEventListener('click', () => {
    const picture = getRun()?.pictureExports();
    if (!picture) return;
    const file = pictureJSON(picture);
    download(file.name, file.blob);
  });

  byId('export-png').addEventListener('click', () =>
    task('PNG', async () => {
      const picture = getRun()?.pictureExports();
      if (!picture) return;
      const file = await picturePNG(picture, Number(exportSize.value));
      download(file.name, file.blob);
    }),
  );

  // ---- Animation (any style) ----

  /** Speed, loops and size chosen for a video, with progress shown on the page. */
  function videoOptions() {
    return {
      fps: loop.fps,
      loops: videoLoops(),
      size: Number(byId<HTMLSelectElement>('video-size').value),
      onProgress: (done: number, total: number) => {
        status.textContent = `Recording video… ${done.toFixed(1)} of ${total.toFixed(1)} s (keep this tab visible)`;
      },
    };
  }

  function videoLoops(): number {
    return Math.max(1, Math.min(20, Math.round(Number(byId<HTMLInputElement>('video-loops').value)) || 4));
  }

  byId('export-anim-svg').addEventListener('click', () => {
    const animation = getRun()?.animationExports();
    if (!animation) return;
    download(`${animation.baseName}.svg`, new Blob([animation.animatedSVG(loop.fps)], { type: 'image/svg+xml' }));
  });

  byId('export-anim-json').addEventListener('click', () => {
    const animation = getRun()?.animationExports();
    if (!animation) return;
    download(`${animation.baseName}.json`, new Blob([animation.json(loop.fps)], { type: 'application/json' }));
  });

  byId('export-anim-zip').addEventListener('click', () =>
    task('PNG frames', async () => {
      const animation = getRun()?.animationExports();
      if (!animation) return;
      const size = Number(exportSize.value);
      const file = await pngFramesZip(animation, size, (done, total) => {
        status.textContent = `Rendering PNG frames… ${done} of ${total}`;
      });
      const saved = download(file.name, file.blob);
      status.textContent = `Saved ${saved} (${formatBytes(file.blob.size)}).`;
    }),
  );

  byId('export-anim-video').addEventListener('click', () =>
    task('Video', async () => {
      const animation = getRun()?.animationExports();
      if (!animation) return;
      if (!pickVideoType()) {
        status.textContent = 'This browser cannot record video. Try Chrome, Edge or Firefox, or export PNG frames instead.';
        return;
      }
      const file = await animationVideo(animation, videoOptions());
      const saved = download(file.name, file.blob);
      status.textContent = `Saved ${saved} (${file.mimeType}, ${formatBytes(file.blob.size)}).`;
    }),
  );

  byId('export-anim-gif').addEventListener('click', () =>
    task('GIF', async () => {
      const animation = getRun()?.animationExports();
      if (!animation) return;
      const fps = loop.fps;
      const file = await animationGif(animation, {
        fps,
        size: Number(byId<HTMLSelectElement>('gif-size').value),
        onProgress: (message) => {
          status.textContent = message;
        },
      });
      const saved = download(file.name, file.blob);
      lastGif = { name: saved, bytes: file.blob.size, encodeMs: Math.round(file.encodeMs) };
      // GIF timing is in hundredths of a second, so some speeds cannot be kept exactly.
      const timing = gifTiming(fps);
      const speedNote = timing.rounded
        ? ` GIF stores frame times in hundredths of a second, so it plays at ${timing.actualFps.toFixed(2)} fps instead of ${fps}.`
        : '';
      status.textContent = `Saved ${saved} (${formatBytes(file.blob.size)}).${speedNote}`;
    }),
  );

  // ---- Share or save to Photos (only where the browser can share files) ----
  //
  // The same files as the PNG, video and GIF downloads, handed to the share
  // sheet instead. Each `key` lists what the file is made from, so a file made
  // earlier is not shared after the result or a setting has changed.

  /** Make files with the export buttons locked, as for a download; errors are shown by the share button. */
  async function whileBusy<T>(work: () => Promise<T>): Promise<T> {
    deps.onBusyChange(true);
    try {
      return await work();
    } finally {
      deps.onBusyChange(false);
    }
  }

  const shareButtons = [
    setUpShareButton(byId<HTMLButtonElement>('export-share-png'), {
      what: 'PNG',
      type: 'image/png',
      key: () => [getRun(), deps.fileStem(), exportSize.value],
      prepare: () =>
        whileBusy(async () => {
          const picture = getRun()?.pictureExports();
          if (!picture) return null;
          const file = await picturePNG(picture, Number(exportSize.value));
          return [shareableFile(fileName(file.name), file.blob)];
        }),
      status,
      showError: deps.showError,
    }),
    setUpShareButton(byId<HTMLButtonElement>('export-share-gif'), {
      what: 'GIF',
      type: 'image/gif',
      key: () => [getRun(), deps.fileStem(), byId<HTMLSelectElement>('gif-size').value, loop.fps],
      prepare: () =>
        whileBusy(async () => {
          const animation = getRun()?.animationExports();
          if (!animation) return null;
          const file = await animationGif(animation, {
            fps: loop.fps,
            size: Number(byId<HTMLSelectElement>('gif-size').value),
            onProgress: (message) => {
              status.textContent = message;
            },
          });
          return [shareableFile(fileName(file.name), file.blob)];
        }),
      status,
      showError: deps.showError,
    }),
    // Only where this browser records video at all; the type is the one it records (MP4 in Safari).
    setUpShareButton(byId<HTMLButtonElement>('export-share-video'), {
      what: 'video',
      type: pickVideoType()?.split(';')[0] ?? '',
      key: () => [getRun(), deps.fileStem(), byId<HTMLSelectElement>('video-size').value, videoLoops(), loop.fps],
      prepare: () =>
        whileBusy(async () => {
          const animation = getRun()?.animationExports();
          if (!animation) return null;
          const file = await animationVideo(animation, videoOptions());
          return [shareableFile(fileName(file.name), file.blob)];
        }),
      status,
      showError: deps.showError,
    }),
  ];

  function refreshShares(): void {
    for (const button of shareButtons) button?.refresh();
  }
  // A changed size or number of loops makes a file made for sharing out of date.
  exportSize.closest('section')?.addEventListener('change', refreshShares);

  return { lastGif: () => lastGif, task, whileBusy, refreshShares };
}
