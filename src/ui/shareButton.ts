// A "Share ..." button beside the downloads: it makes the file(s), then opens
// the system share sheet, from which an iPhone can save them to Photos. The
// button stays hidden where the browser cannot share files of that type, so
// desktop browsers without sharing show only the downloads.
//
// The flow itself (two taps when making the file takes too long, cancelling,
// errors) is in shareFiles.ts; this file only keeps the button up to date.

import { canShareType, createShareFlow, type ShareFlow } from './shareFiles';

/** iPhone, iPad and Mac, whose share sheets can save images and videos to Photos. */
function isApple(): boolean {
  // iPads describe themselves as a Mac ("Macintosh"), which is fine here.
  return /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);
}

export interface ShareButton {
  /** Forget a made file if what it was made from has changed. */
  refresh(): void;
}

export function setUpShareButton(
  button: HTMLButtonElement,
  options: {
    /** What is shared, for the button: "PNG", "GIF", "video", "all". */
    what: string;
    /** The MIME type checked to decide whether to show the button. */
    type: string;
    /** Make the files to share (the export buttons are locked meanwhile), or null. */
    prepare(): Promise<File[] | null>;
    /** What the files depend on; see createShareFlow. */
    key(): readonly unknown[];
    status: HTMLElement;
    showError(message: string): void;
  },
): ShareButton | null {
  if (!canShareType(options.type)) {
    button.hidden = true;
    return null;
  }
  const idleLabel = isApple() ? `Share ${options.what} or save to Photos` : `Share ${options.what}`;
  const readyLabel = `Tap to share ${options.what}`;

  const flow: ShareFlow = createShareFlow({
    prepare: async () => {
      const files = await options.prepare();
      // Clear the progress message ("Encoding GIF…") once the files are made.
      if (files) options.status.textContent = '';
      return files;
    },
    key: options.key,
    onChange: (state, message) => {
      const ready = state === 'ready';
      button.textContent = ready ? readyLabel : idleLabel;
      button.classList.toggle('primary', ready);
      // An empty message leaves the status line alone (it may say how a file was saved instead).
      if (message) options.status.textContent = message;
    },
    onError: (error) => {
      options.status.textContent = '';
      options.showError(`Sharing failed: ${error instanceof Error ? error.message : String(error)}`);
    },
  });

  button.textContent = idleLabel;
  button.hidden = false;
  button.addEventListener('click', () => void flow.tap());
  return { refresh: () => flow.refresh() };
}
