// Shared timing for tests, so that no test depends on how fast or how busy
// the machine is.

/**
 * Timeout for the tests that run the real engines end to end several times
 * over, or brute-force check every pixel (about 1-2 s each on a fast, idle
 * machine). On a starved machine they were measured at up to 40 s; the
 * vitest default of 5 s made them fail on a merely busy one. Every other
 * test runs under the global testTimeout in vite.config.ts.
 */
export const LONG_TEST_TIMEOUT = 120_000;

/**
 * Let the event loop go round `turns` times, so that queued timers and
 * setImmediate callbacks (the runners' next step) get to run. Used to check
 * that a paused or disposed runner really stays still: a fixed number of
 * turns gives a still-running runner the same number of chances to move
 * however slow the machine is, where a fixed wait in milliseconds gives it
 * fewer the busier the machine.
 */
export async function eventLoopTurns(turns = 50): Promise<void> {
  for (let i = 0; i < turns; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}
