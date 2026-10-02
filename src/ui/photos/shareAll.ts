// "Share all": every finished photo as a PNG (or a GIF for an animation),
// handed to the share sheet together, so an iPhone can save them all to
// Photos at once. The files are the ones Export all puts in its zip.
//
// Browsers limit how much one share may hold (Chrome: 10 files, 50 MB), so
// beyond that the same files are saved as the Export all zip instead.

import { SHARE_LIMITS, shareableFile, withinShareLimits } from '../shareFiles';
import { exportAllFiles, exportAllZip, zipExportAllFiles, type ExportAllOptions } from './exportAll';
import type { StoredResult } from './storedResult';

/**
 * The files to share, or null if there were too many or they were too large
 * (then they were saved as a zip with `save`, and `say` explains why).
 */
export async function shareAllFiles(
  items: Array<{ stem: string; stored: StoredResult }>,
  options: Omit<ExportAllOptions, 'format'>,
  save: (name: string, blob: Blob) => void,
  say: (text: string) => void,
): Promise<File[] | null> {
  const format = 'image';
  if (items.length > SHARE_LIMITS.maxFiles) {
    // Known before making anything, so make the zip straight away.
    const zip = await exportAllZip(items, { ...options, format });
    save(zip.name, zip.blob);
    say(`At most ${SHARE_LIMITS.maxFiles} photos can be shared at once, so all ${items.length} were saved as ${zip.name}.`);
    return null;
  }
  const made = await exportAllFiles(items, { ...options, format });
  const files = made.map((file) => shareableFile(file.name, new Blob([file.data as BlobPart], { type: file.type })));
  if (!withinShareLimits(files)) {
    const zip = zipExportAllFiles(made, format);
    save(zip.name, zip.blob);
    say(`Together these are over 50 MB, too large to share at once, so they were saved as ${zip.name}.`);
    return null;
  }
  return files;
}
