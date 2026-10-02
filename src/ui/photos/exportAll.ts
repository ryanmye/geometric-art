// "Export all": every finished photo's result in one zip.
//
// Formats: "vector" (SVG, or animated SVG for an animation), "image" (PNG at
// the PNG size, or GIF at the GIF size for an animation) and "json". Video is
// left out because it records in real time. Files are named after the
// original photos (each item's stem, from exportStems), plus style and seed.
//
// The same files (as "image") are also what "Share all" hands to the share
// sheet, so exportAllFiles makes the list and exportAllZip zips it.
//
// Memory: each file is made one after another and kept as bytes; the zip is
// then handed to the browser as a list of parts (createZipParts), so no
// second copy of everything is built. In practice that limits a zip to what
// the files themselves take: e.g. 40 photos as 2048 px PNGs is about 120 MB.

import { createZipParts, type ZipEntry } from '../../render/zip';
import { animationGif } from '../exports/animationFiles';
import { picturePNG } from '../exports/pictureFiles';
import { exportEntryName } from './fileNames';
import { storedExports } from './storedRun';
import type { StoredResult } from './storedResult';

export type ExportAllFormat = 'vector' | 'image' | 'json';

export interface ExportAllOptions {
  format: ExportAllFormat;
  pngSize: number;
  gifSize: number;
  fps: number;
  onProgress?(text: string): void;
}

/** One photo's file: its name and bytes, plus its MIME type (e.g. "image/png"). */
export interface ExportAllFile extends ZipEntry {
  type: string;
}

/** Every finished photo's file in the chosen format, made one after another. */
export async function exportAllFiles(
  items: Array<{ stem: string; stored: StoredResult }>,
  options: ExportAllOptions,
): Promise<ExportAllFile[]> {
  if (items.length === 0) throw new Error('No photo has a finished result to export yet.');
  const encoder = new TextEncoder();
  const files: ExportAllFile[] = [];

  for (let i = 0; i < items.length; i++) {
    const { stem, stored } = items[i];
    options.onProgress?.(`Preparing ${i + 1} of ${items.length}…`);
    const { picture, animation } = storedExports(stored);
    const seed = stored.snapshot.config.seed;
    const name = (extension: string) => exportEntryName(stem, stored.style, seed, extension);
    let data: Uint8Array;
    let extension: string;
    let type: string;
    if (options.format === 'json') {
      extension = 'json';
      type = 'application/json';
      data = encoder.encode(picture ? picture.json() : animation!.json(options.fps));
    } else if (options.format === 'vector') {
      extension = 'svg';
      type = 'image/svg+xml';
      data = encoder.encode(picture ? picture.svg() : animation!.animatedSVG(options.fps));
    } else if (picture) {
      extension = 'png';
      type = 'image/png';
      data = new Uint8Array(await (await picturePNG(picture, options.pngSize)).blob.arrayBuffer());
    } else {
      extension = 'gif';
      type = 'image/gif';
      const gif = await animationGif(animation!, { fps: options.fps, size: options.gifSize });
      data = new Uint8Array(await gif.blob.arrayBuffer());
    }
    files.push({ name: name(extension), data, type });
    // Let the page update between files.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return files;
}

/** Files from exportAllFiles in one zip, named after how many there are and the format. */
export function zipExportAllFiles(
  files: ExportAllFile[],
  format: ExportAllFormat,
): { name: string; blob: Blob; count: number } {
  const parts = createZipParts(files);
  return {
    name: `geometric-art-${files.length}-photos-${format}.zip`,
    blob: new Blob(parts as BlobPart[], { type: 'application/zip' }),
    count: files.length,
  };
}

export async function exportAllZip(
  items: Array<{ stem: string; stored: StoredResult }>,
  options: ExportAllOptions,
): Promise<{ name: string; blob: Blob; count: number }> {
  return zipExportAllFiles(await exportAllFiles(items, options), options.format);
}
