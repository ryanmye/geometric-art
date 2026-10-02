import { describe, expect, it, vi } from 'vitest';
import { retryableMemo } from '../../src/decode/retryableMemo';

describe('retryableMemo: caching a load that must stay retryable after failure', () => {
  it('calls the factory only once across repeated successful calls', async () => {
    const factory = vi.fn(async () => 'module');
    const get = retryableMemo(factory);

    await expect(get()).resolves.toBe('module');
    await expect(get()).resolves.toBe('module');
    await expect(get()).resolves.toBe('module');
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight promise for calls that overlap before the first resolves', async () => {
    let resolveFirst: (value: string) => void = () => {};
    const factory = vi.fn(() => new Promise<string>((resolve) => (resolveFirst = resolve)));
    const get = retryableMemo(factory);

    const first = get();
    const second = get();
    expect(factory).toHaveBeenCalledTimes(1);
    resolveFirst('module');
    await expect(first).resolves.toBe('module');
    await expect(second).resolves.toBe('module');
  });

  it('this is the heart of the fix: a rejection is never cached, so the very next call retries', async () => {
    const factory = vi.fn(async () => {
      throw new Error('network blocked');
    });
    const get = retryableMemo(factory);

    await expect(get()).rejects.toThrow('network blocked');
    await expect(get()).rejects.toThrow('network blocked');
    await expect(get()).rejects.toThrow('network blocked');
    // Contrast with `if (!cached) cached = factory()`: that would call the
    // factory exactly once, ever, and every one of the three calls above
    // would silently reuse the first rejection instead of retrying.
    expect(factory).toHaveBeenCalledTimes(3);
  });

  it('recovers once the factory starts succeeding again (the network coming back)', async () => {
    let shouldFail = true;
    const factory = vi.fn(async () => {
      if (shouldFail) throw new Error('offline');
      return 'module';
    });
    const get = retryableMemo(factory);

    await expect(get()).rejects.toThrow('offline');
    shouldFail = false;
    await expect(get()).resolves.toBe('module');
    // And now that it has succeeded, it stays cached rather than re-fetching.
    await expect(get()).resolves.toBe('module');
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('a slow, now-superseded failure must not evict a newer successful result', async () => {
    // Simulates: call A starts, is slow; call B starts after A's failure
    // already cleared the cache and succeeds; A's rejection handler then
    // runs and must not clobber B's now-cached success.
    let rejectFirst: (error: Error) => void = () => {};
    const factory = vi
      .fn()
      .mockImplementationOnce(() => new Promise((_, reject) => (rejectFirst = reject)))
      .mockImplementationOnce(async () => 'module');
    const get = retryableMemo(factory);

    const first = get();
    rejectFirst(new Error('slow failure'));
    await expect(first).rejects.toThrow('slow failure');

    await expect(get()).resolves.toBe('module');
    await expect(get()).resolves.toBe('module');
    expect(factory).toHaveBeenCalledTimes(2);
  });
});
