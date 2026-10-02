// Why a file could not be added, in the visitor's words, for the "Skipped
// files" message. The decoders' own error messages are matched loosely.

export function skipReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/not look like an image/i.test(message)) return 'not an image';
  // Errors from the HEIC path start with "HEIC:" (see decodePhotoFile).
  if (message.startsWith('HEIC:')) {
    // The decoder crashed or stopped answering (e.g. out of memory on a huge photo); it is restarted next time.
    if (/HEIC decoder stopped/i.test(message)) return 'the HEIC decoder stopped before finishing (the photo may be too large); try adding it again';
    // The HEIC decoder (a separate download) could not be fetched or started.
    if (/load the HEIC decoder|start the HEIC decoder|decoder failed to run|dynamically imported module|Failed to fetch|NetworkError|Importing a module script failed/i.test(message)) {
      return 'the HEIC decoder could not be downloaded; check the connection and try again';
    }
    // The decoder says this both for damaged files and for kinds it cannot read.
    if (/codec this decoder does not support/i.test(message)) return 'a HEIC photo that is damaged or of a kind this decoder cannot read';
    return 'a damaged HEIC photo';
  }
  return 'could not be read as an image';
}

/**
 * The skipped-files message: "Skipped 2 files: notes.txt (not an image),
 * broken.heic (a damaged HEIC photo)." Empty when nothing was skipped.
 */
export function skippedMessage(skipped: Array<{ name: string; reason: string }>): string {
  if (skipped.length === 0) return '';
  const list = skipped.map((file) => `${file.name} (${file.reason})`).join(', ');
  return `Skipped ${skipped.length === 1 ? '1 file' : `${skipped.length} files`}: ${list}.`;
}
