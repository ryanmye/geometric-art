// Sharing finished files with the system share sheet (the Web Share API).
//
// A web page cannot save into the photo library itself. Instead it can hand
// files to navigator.share(), which opens the share sheet: on an iPhone that
// offers "Save Image" / "Save Video" (into Photos), on Android the gallery and
// other apps, and on a Mac or PC the apps that take files.
//
// Things to know about navigator.share():
// - It only works straight after a tap or click ("transient user activation",
//   about 5 seconds in Safari and Chrome). Making a GIF or recording a video
//   takes longer, so then the first tap makes the file and the button asks for
//   a second tap to open the sheet (see createShareFlow below).
// - If the visitor closes the sheet without choosing anything, it rejects with
//   an "AbortError". That is not a failure, so nothing is shown.
// - Chrome refuses more than 10 files, or more than 50 MB in all, in one share
//   (with the same "NotAllowedError" as a missing tap), so we check that first.
//
// Everything here takes the navigator as a parameter, so tests can pass a stand-in.

/** The parts of `navigator` used here. */
export interface ShareNavigator {
  share?(data: { files: File[] }): Promise<void>;
  canShare?(data: { files: File[] }): boolean;
  /** Says whether a tap is still "fresh" enough to share (missing in older browsers). */
  userActivation?: { isActive: boolean };
}

/** The most files, and bytes, shared at once (Chrome's limits; Safari has none of its own). */
export const SHARE_LIMITS = { maxFiles: 10, maxBytes: 50 * 1024 * 1024 };

/** MIME types for the file kinds we share, by extension. */
const TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
};

/** The MIME type for a file name ("photo.png" -> "image/png"), or "" if unknown. */
export function typeForName(name: string): string {
  const extension = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  return TYPES[extension] ?? '';
}

/**
 * A File ready to share. The type comes from the blob, or else from the name.
 * A type with extra details ("video/mp4;codecs=avc1") is cut to the plain
 * type, which is what share targets such as Photos look at.
 */
export function shareableFile(name: string, blob: Blob): File {
  const type = (blob.type || typeForName(name)).split(';')[0].trim();
  return new File([blob], name, { type });
}

/** The browser's navigator, or an empty stand-in where there is none (Node, workers). */
function browserNavigator(): ShareNavigator {
  return typeof navigator === 'undefined' ? {} : (navigator as ShareNavigator);
}

/**
 * Can this browser share files of this type? Checked with a tiny sample file,
 * so it is quick enough to decide whether to show a button.
 */
export function canShareType(type: string, nav: ShareNavigator = browserNavigator()): boolean {
  if (!type || typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return false;
  const extension = Object.keys(TYPES).find((key) => TYPES[key] === type) ?? 'bin';
  try {
    return nav.canShare({ files: [new File(['x'], `sample.${extension}`, { type })] });
  } catch {
    return false;
  }
}

/** Are these files few and small enough to share in one go? */
export function withinShareLimits(files: readonly File[]): boolean {
  const bytes = files.reduce((sum, file) => sum + file.size, 0);
  return files.length > 0 && files.length <= SHARE_LIMITS.maxFiles && bytes <= SHARE_LIMITS.maxBytes;
}

/**
 * What happened when we asked to share:
 * - "shared": the visitor picked something in the sheet (e.g. Save Image).
 * - "cancelled": they closed the sheet.
 * - "needs-tap": the browser said no because the tap was too long ago.
 */
export type ShareOutcome = 'shared' | 'cancelled' | 'needs-tap';

function errorName(error: unknown): string {
  return error instanceof Error || (typeof error === 'object' && error !== null && 'name' in error)
    ? String((error as { name: unknown }).name)
    : '';
}

/**
 * Open the share sheet with these files. The call to navigator.share()
 * happens straight away (before anything is awaited), so it still counts as
 * part of the tap that called this. Other failures are thrown as errors.
 */
export async function shareFiles(files: File[], nav: ShareNavigator = browserNavigator()): Promise<ShareOutcome> {
  if (typeof nav.share !== 'function') throw new Error('This browser cannot share files.');
  if (!withinShareLimits(files)) {
    throw new Error(`Too many or too large to share at once (at most ${SHARE_LIMITS.maxFiles} files and 50 MB).`);
  }
  if (typeof nav.canShare === 'function' && !nav.canShare({ files })) {
    throw new Error('This browser cannot share these files.');
  }
  try {
    await nav.share({ files });
    return 'shared';
  } catch (error) {
    const name = errorName(error);
    if (name === 'AbortError') return 'cancelled';
    if (name === 'NotAllowedError') return 'needs-tap';
    throw error;
  }
}

/**
 * Where a share button is:
 * - "idle": nothing made yet.
 * - "preparing": making the files.
 * - "ready": the files are made and waiting for a tap to open the share sheet.
 */
export type ShareState = 'idle' | 'preparing' | 'ready';

export interface ShareFlow {
  readonly state: ShareState;
  /** The button was tapped. */
  tap(): Promise<void>;
  /** Forget files made for settings that have since changed (call when the page changes). */
  refresh(): void;
  /** Forget any files made. */
  reset(): void;
}

/**
 * The two-tap flow behind one share button.
 *
 * First tap: make the files (`prepare`), then try to share them at once. If
 * the browser says the tap is too old, keep the files and wait in "ready" for
 * a second tap, which opens the sheet immediately. If the visitor closes the
 * sheet, the files are kept too, so another tap opens it again without making
 * them again.
 *
 * `key` describes what the files are made from (the run, sizes, speed, ...);
 * if it has changed since, the kept files are out of date and are dropped.
 */
export function createShareFlow(options: {
  /** Make the files; null if there is nothing to share (e.g. it was saved some other way). */
  prepare(): Promise<File[] | null>;
  key(): readonly unknown[];
  /** Called whenever the state changes, with a short message for the page ("" for none). */
  onChange(state: ShareState, message: string): void;
  onError(error: unknown): void;
  navigator?: ShareNavigator;
}): ShareFlow {
  const nav = options.navigator ?? browserNavigator();
  let state: ShareState = 'idle';
  let files: File[] | null = null;
  let filesKey: readonly unknown[] = [];

  function set(next: ShareState, message: string): void {
    state = next;
    if (next !== 'ready') files = null;
    options.onChange(next, message);
  }

  function sameKey(a: readonly unknown[], b: readonly unknown[]): boolean {
    return a.length === b.length && a.every((value, i) => value === b[i]);
  }

  function describe(list: File[]): string {
    return list.length === 1 ? list[0].name : `${list.length} files`;
  }

  function readyMessage(list: File[]): string {
    const ready = list.length === 1 ? 'The file is ready.' : `The ${list.length} files are ready.`;
    return `${ready} Tap the button again to share or save.`;
  }

  /** Share the kept files; `secondTry` is true when this tap was only for sharing. */
  async function share(list: File[], secondTry: boolean): Promise<void> {
    let outcome: ShareOutcome;
    try {
      outcome = await shareFiles(list, nav);
    } catch (error) {
      set('idle', '');
      options.onError(error);
      return;
    }
    if (outcome === 'shared') {
      set('idle', `Shared ${describe(list)}.`);
    } else if (outcome === 'cancelled') {
      // Keep the files: another tap opens the sheet again.
      set('ready', '');
    } else if (!secondTry) {
      set('ready', readyMessage(list));
    } else {
      // A fresh tap was refused, so the browser is blocking it for another reason.
      set('idle', '');
      options.onError(new Error('The browser did not allow sharing these files.'));
    }
  }

  return {
    get state() {
      return state;
    },

    async tap() {
      if (state === 'preparing') return;
      if (state === 'ready' && files && sameKey(filesKey, options.key())) {
        // Nothing may be awaited before navigator.share() here, or the tap no longer counts.
        await share(files, true);
        return;
      }
      const key = options.key();
      set('preparing', '');
      let made: File[] | null;
      try {
        made = await options.prepare();
      } catch (error) {
        set('idle', '');
        options.onError(error);
        return;
      }
      if (!made || made.length === 0) {
        set('idle', '');
        return;
      }
      files = made;
      filesKey = key;
      // If the browser can tell us the tap has already expired, go straight to the second tap.
      if (nav.userActivation && !nav.userActivation.isActive) {
        set('ready', readyMessage(made));
        return;
      }
      state = 'ready'; // keep the files while the sheet is open
      await share(made, false);
    },

    refresh() {
      if (state === 'ready' && !sameKey(filesKey, options.key())) set('idle', '');
    },

    reset() {
      if (state === 'ready') set('idle', '');
    },
  };
}
