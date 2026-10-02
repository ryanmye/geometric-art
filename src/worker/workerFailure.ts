// Turning a worker's 'error' event into an error the visitor can act on.
//
// A worker whose script cannot be downloaded (offline, blocked, a 404 after a
// new deploy) reports only through its 'error' event, with no message: the
// browser gives a plain Event rather than an ErrorEvent. An exception thrown
// inside a running worker comes as an ErrorEvent with a message. Each run
// creates new workers, so pressing Start again fetches the script again.

/** Shown when a worker script could not be downloaded. */
export const WORKER_DOWNLOAD_FAILED = 'Part of the page could not be downloaded. Check your connection and try again.';

/**
 * The error for a worker's 'error' event. `what` names the worker for other
 * failures ("Search worker"); `heardFrom` is whether it has sent a message
 * yet (if so, its script did load).
 */
export function workerError(what: string, event: Event, heardFrom: boolean): Error {
  const message = 'message' in event && typeof event.message === 'string' ? event.message : '';
  if (!message && !heardFrom) return new Error(WORKER_DOWNLOAD_FAILED);
  return new Error(`${what} failed to run: ${message || 'unknown error'}`);
}
