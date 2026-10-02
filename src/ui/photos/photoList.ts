// The list of loaded photos and which one is current. No DOM here: the page
// keeps its own things (the image, its thumbnail) in each photo's `extra`.

import type { StoredResult } from './storedResult';

/** Whether a photo has a result: none yet, being made, finished, or failed. */
export type PhotoStatus = 'none' | 'running' | 'done' | 'failed';

export interface Photo<Extra> {
  /** Unique within the page; never reused. */
  id: number;
  /** The original file name, or the sample's title. */
  name: string;
  status: PhotoStatus;
  /** Why the latest run failed (when status is 'failed'). */
  error: string | null;
  /** The latest finished result, kept so switching back shows it again. */
  result: StoredResult | null;
  /** The painted "detail here" mask (null when nothing is painted), and the working size it belongs to. */
  mask: Uint8Array | null;
  maskSize: { width: number; height: number } | null;
  extra: Extra;
}

export interface PhotoList<Extra> {
  readonly photos: readonly Photo<Extra>[];
  readonly current: Photo<Extra> | null;
  /** The most photos the list holds. */
  readonly cap: number;
  /** Add photos at the end, up to the cap. Returns the added ones and how many did not fit. */
  add(items: Array<{ name: string; extra: Extra }>): { added: Photo<Extra>[]; overCap: number };
  /** Make a photo current. Returns false if there is no such photo. */
  select(id: number): boolean;
  /**
   * Remove a photo. If it was current, the next photo becomes current (or the
   * previous one if it was last). Returns the removed photo, or null.
   */
  remove(id: number): Photo<Extra> | null;
  /** Remove every photo. Returns them (so the page can free their images). */
  clear(): Photo<Extra>[];
  find(id: number): Photo<Extra> | null;
  /** Position of a photo in the list (0-based), or -1. */
  indexOf(id: number): number;
}

export function createPhotoList<Extra>(cap: number): PhotoList<Extra> {
  const photos: Photo<Extra>[] = [];
  let currentId: number | null = null;
  let nextId = 1;

  const list: PhotoList<Extra> = {
    get photos() {
      return photos;
    },
    get current() {
      return currentId === null ? null : list.find(currentId);
    },
    cap,
    add(items) {
      const room = Math.max(0, cap - photos.length);
      const added = items.slice(0, room).map(
        (item): Photo<Extra> => ({
          id: nextId++,
          name: item.name,
          status: 'none',
          error: null,
          result: null,
          mask: null,
          maskSize: null,
          extra: item.extra,
        }),
      );
      photos.push(...added);
      return { added, overCap: items.length - added.length };
    },
    select(id) {
      if (!list.find(id)) return false;
      currentId = id;
      return true;
    },
    remove(id) {
      const index = list.indexOf(id);
      if (index < 0) return null;
      const [removed] = photos.splice(index, 1);
      if (currentId === id) {
        const neighbour = photos[index] ?? photos[index - 1] ?? null;
        currentId = neighbour ? neighbour.id : null;
      }
      return removed;
    },
    clear() {
      const removed = photos.splice(0, photos.length);
      currentId = null;
      return removed;
    },
    find(id) {
      return photos.find((photo) => photo.id === id) ?? null;
    },
    indexOf(id) {
      return photos.findIndex((photo) => photo.id === id);
    },
  };
  return list;
}
