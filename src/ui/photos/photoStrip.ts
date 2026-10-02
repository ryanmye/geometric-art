// The loaded photos: a scrolling row of thumbnails (a listbox, one option per
// photo, the current one selected), each with a mark for its result (none,
// in progress, done, failed) that differs in shape as well as colour, and the
// Remove and Clear all controls. With one photo only "Remove photo" shows,
// so the page looks much as it always has. Choosing, removing and clearing
// are ignored while the page is locked (a run, or photos being added).
//
// Thumbnails are kept and updated in place rather than rebuilt, so keyboard
// focus stays where it is; the row scrolls itself (never the page) to show
// the current photo when it changes.

import type { Photo, PhotoStatus } from './photoList';
import { resultKind } from './storedResult';

/** What the strip needs to know about each photo from the page. */
export interface StripExtra {
  thumbnail: HTMLCanvasElement;
}

const STATUS_TEXT: Record<PhotoStatus, string> = {
  none: 'no result yet',
  running: 'in progress',
  done: 'finished',
  failed: 'failed',
};

/** What a thumbnail says about its photo (its accessible name and tooltip). */
function photoLabel(photo: Photo<StripExtra>): string {
  let label = `${photo.name}: ${STATUS_TEXT[photo.status]}`;
  if (photo.status === 'done' && photo.result) label += ` (${resultKind(photo.result)})`;
  if (photo.status === 'failed' && photo.error) label += ` (${photo.error})`;
  return label;
}

export interface PhotoStrip {
  render(photos: readonly Photo<StripExtra>[], currentId: number | null, locked: boolean): void;
  onSelect: ((id: number) => void) | null;
  onRemove: (() => void) | null;
  onClear: (() => void) | null;
}

export function setUpPhotoStrip(elements: {
  group: HTMLElement;
  /** The listbox that holds the thumbnails (and scrolls). */
  list: HTMLElement;
  count: HTMLElement;
  removeButton: HTMLButtonElement;
  clearButton: HTMLButtonElement;
  /** "Clear all 12 photos? Yes / Cancel", shown in place of Clear all. */
  clearConfirm: HTMLElement;
  clearQuestion: HTMLElement;
  clearYes: HTMLButtonElement;
  clearCancel: HTMLButtonElement;
}): PhotoStrip {
  const { group, list, count, removeButton, clearButton, clearConfirm, clearQuestion, clearYes, clearCancel } = elements;
  let locked = false;
  let ids: number[] = [];
  let currentId: number | null = null;
  /** The thumbnail for each photo id, kept between renders. */
  const thumbs = new Map<number, HTMLElement>();

  function makeThumb(photo: Photo<StripExtra>): HTMLElement {
    const thumb = document.createElement('div');
    thumb.className = 'photo-thumb';
    thumb.setAttribute('role', 'option');
    thumb.dataset.id = String(photo.id);
    const mark = document.createElement('span');
    mark.className = 'photo-mark';
    mark.setAttribute('aria-hidden', 'true');
    thumb.append(photo.extra.thumbnail, mark);
    return thumb;
  }

  /** Scroll the row (only the row) so the thumbnail is fully visible. */
  function scrollToThumb(thumb: HTMLElement): void {
    const row = list.getBoundingClientRect();
    const box = thumb.getBoundingClientRect();
    const margin = 8;
    if (box.left < row.left + margin) list.scrollLeft -= row.left + margin - box.left;
    else if (box.right > row.right - margin) list.scrollLeft += box.right - (row.right - margin);
  }

  function setConfirming(on: boolean): void {
    clearConfirm.hidden = !on;
    clearButton.hidden = on;
  }

  const strip: PhotoStrip = {
    render(photos, newCurrentId, newLocked) {
      const currentChanged = newCurrentId !== currentId;
      locked = newLocked;
      currentId = newCurrentId;
      ids = photos.map((photo) => photo.id);
      const several = photos.length > 1;
      group.hidden = photos.length === 0;
      count.hidden = !several;
      list.hidden = !several;
      const position = ids.indexOf(currentId ?? -1) + 1;
      count.textContent = `Photo ${position} of ${photos.length}`;
      removeButton.textContent = several ? 'Remove' : 'Remove photo';
      removeButton.disabled = locked || currentId === null;
      clearButton.disabled = locked;
      clearYes.disabled = locked;
      clearQuestion.textContent = `Clear all ${photos.length} photos and their results?`;
      if (!several) {
        clearButton.hidden = true;
        clearConfirm.hidden = true;
      } else if (clearConfirm.hidden) {
        clearButton.hidden = false;
      }

      // Drop thumbnails of removed photos, add new ones at the end (photos
      // are only ever added at the end), and update each in place.
      for (const [id, thumb] of thumbs) {
        if (!ids.includes(id)) {
          thumb.remove();
          thumbs.delete(id);
        }
      }
      for (const photo of photos) {
        let thumb = thumbs.get(photo.id);
        if (!thumb) {
          thumb = makeThumb(photo);
          thumbs.set(photo.id, thumb);
          list.append(thumb);
        }
        const current = photo.id === currentId;
        const label = photoLabel(photo);
        if (thumb.title !== label) {
          thumb.title = label;
          thumb.setAttribute('aria-label', label);
        }
        thumb.dataset.status = photo.status;
        thumb.setAttribute('aria-selected', String(current));
        thumb.setAttribute('aria-disabled', String(locked && !current));
        // Only the current photo is in the Tab order; arrow keys, Home and End move between photos.
        thumb.tabIndex = current ? 0 : -1;
      }

      const currentThumb = currentId === null ? undefined : thumbs.get(currentId);
      if (currentChanged && currentThumb && several) scrollToThumb(currentThumb);
    },
    onSelect: null,
    onRemove: null,
    onClear: null,
  };

  function choose(id: number | undefined, focus: boolean): void {
    if (id === undefined || locked) return;
    if (id !== currentId) strip.onSelect?.(id);
    // The row has already scrolled to show it; do not let focus scroll the page.
    if (focus) thumbs.get(currentId ?? -1)?.focus({ preventScroll: true });
  }

  list.addEventListener('click', (event) => {
    const thumb = (event.target as HTMLElement).closest<HTMLElement>('.photo-thumb');
    if (thumb) choose(Number(thumb.dataset.id), true);
  });
  // While locked, a press on another photo does nothing, not even move focus there.
  list.addEventListener('mousedown', (event) => {
    const thumb = (event.target as HTMLElement).closest<HTMLElement>('.photo-thumb');
    if (thumb && locked && Number(thumb.dataset.id) !== currentId) event.preventDefault();
  });
  list.addEventListener('keydown', (event) => {
    if (currentId === null) return;
    const at = ids.indexOf(currentId);
    const moves: Record<string, number | undefined> = {
      ArrowRight: ids[at + 1],
      ArrowDown: ids[at + 1],
      ArrowLeft: ids[at - 1],
      ArrowUp: ids[at - 1],
      Home: ids[0],
      End: ids[ids.length - 1],
    };
    if (!(event.key in moves)) return;
    event.preventDefault();
    choose(moves[event.key], true);
  });

  removeButton.addEventListener('click', () => {
    if (!locked) strip.onRemove?.();
  });
  // Clear all asks first, in place: "Clear all 12 photos and their results? Yes, clear all / Cancel".
  clearButton.addEventListener('click', () => {
    if (locked) return;
    setConfirming(true);
    clearCancel.focus();
  });
  clearCancel.addEventListener('click', () => {
    setConfirming(false);
    clearButton.focus();
  });
  clearYes.addEventListener('click', () => {
    if (locked) return;
    setConfirming(false);
    strip.onClear?.();
  });
  clearConfirm.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    setConfirming(false);
    clearButton.focus();
  });
  return strip;
}
