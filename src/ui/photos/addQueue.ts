// Adding photos: batches of files are added one batch after another, and a
// batch of files fills the room left under the cap. No DOM here.

export interface TaskQueue {
  /**
   * Run `task` after every task added before it has finished. The returned
   * promise always resolves (never rejects): if the task throws, `onError`
   * hears about it and later tasks still run.
   */
  run(task: () => Promise<void>): Promise<void>;
  /** Tasks waiting or running. */
  readonly pending: number;
}

export function createTaskQueue(onError: (error: unknown) => void): TaskQueue {
  let tail: Promise<void> = Promise.resolve();
  let pending = 0;
  return {
    run(task) {
      pending++;
      const done = tail
        .then(task)
        .catch((error) => onError(error))
        .finally(() => {
          pending--;
        });
      tail = done;
      return done;
    },
    get pending() {
      return pending;
    },
  };
}

/**
 * Try sources in order until `room` of them have been added. `tryOne` adds
 * one and says whether it worked; a source that could not be added does not
 * use up room. Returns how many were added and the sources never tried
 * because the room ran out.
 */
export async function fillRoom<Source>(
  sources: Source[],
  room: number,
  tryOne: (source: Source, index: number) => Promise<boolean>,
): Promise<{ added: number; notTried: Source[] }> {
  let added = 0;
  let index = 0;
  for (; index < sources.length && added < room; index++) {
    if (await tryOne(sources[index], index)) added++;
  }
  return { added, notTried: sources.slice(index) };
}
