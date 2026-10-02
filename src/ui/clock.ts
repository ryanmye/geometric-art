// Running time that does not count pauses.

export interface Clock {
  start(): void;
  stop(): void;
  reset(): void;
  /** Milliseconds spent running so far. */
  elapsedMs(): number;
}

export function createClock(): Clock {
  let activeMs = 0;
  let runningSince: number | null = null;
  return {
    start() {
      if (runningSince === null) runningSince = performance.now();
    },
    stop() {
      if (runningSince !== null) activeMs += performance.now() - runningSince;
      runningSince = null;
    },
    reset() {
      activeMs = 0;
      runningSince = null;
    },
    elapsedMs() {
      return activeMs + (runningSince === null ? 0 : performance.now() - runningSince);
    },
  };
}
