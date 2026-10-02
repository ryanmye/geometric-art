// A small piece of plumbing used to load the HEIC decoder's pieces (the
// worker's wasm module) exactly once per success, while staying retryable
// forever after a failure.
//
// The bug this exists to avoid: a dynamic `import()` of a module specifier
// that fails to load is cached by the browser for the rest of the page's
// life — there is no way to retry it, even once the network recovers. A
// naively memoised promise (`if (!cached) cached = factory()`) has exactly
// the same failure mode: once `factory()` rejects, that rejected promise
// *is* the cached value, and every later call keeps returning it without
// ever calling `factory()` again. `retryableMemo` only caches a *resolved*
// value; a rejection clears the cache first, so the next call starts over.

/**
 * Wrap an async factory so repeated calls share one in-flight/resolved
 * result, but a rejection is never cached: the next call after a failure
 * runs the factory again from scratch.
 */
export function retryableMemo<T>(factory: () => Promise<T>): () => Promise<T> {
  let cached: Promise<T> | null = null;
  return function get(): Promise<T> {
    if (cached) return cached;
    const attempt = factory();
    cached = attempt;
    attempt.catch(() => {
      // Only clear if this attempt is still the current one: a slow,
      // now-superseded attempt rejecting later must not evict a newer,
      // already-resolved cache entry.
      if (cached === attempt) cached = null;
    });
    return attempt;
  };
}
