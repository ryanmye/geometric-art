import { describe, expect, it, vi } from 'vitest';
import {
  canShareType,
  createShareFlow,
  shareableFile,
  shareFiles,
  SHARE_LIMITS,
  typeForName,
  withinShareLimits,
  type ShareNavigator,
  type ShareState,
} from '../../src/ui/shareFiles';

const png = (name = 'picture.png', bytes = 10) => new File([new Uint8Array(bytes)], name, { type: 'image/png' });

/** A stand-in navigator whose share() does what `result` says. */
function fakeNavigator(result: 'ok' | string = 'ok', options: { canShare?: boolean; active?: boolean } = {}) {
  const share = vi.fn((data: { files: File[] }) => {
    void data;
    return result === 'ok' ? Promise.resolve() : Promise.reject(new DOMException('no', result));
  });
  const canShare = vi.fn(() => options.canShare ?? true);
  const nav: ShareNavigator = { share, canShare };
  if (options.active !== undefined) nav.userActivation = { isActive: options.active };
  return { nav, share, canShare };
}

describe('share files: types and limits', () => {
  it('knows the types of the files we share', () => {
    expect(typeForName('a.png')).toBe('image/png');
    expect(typeForName('A.GIF')).toBe('image/gif');
    expect(typeForName('clip.mp4')).toBe('video/mp4');
    expect(typeForName('notes.json')).toBe('');
  });

  it('makes Files with the type from the blob, or else from the name, without codec details', () => {
    expect(shareableFile('x.mp4', new Blob(['v'], { type: 'video/mp4;codecs=avc1' })).type).toBe('video/mp4');
    expect(shareableFile('x.gif', new Blob(['g'])).type).toBe('image/gif');
    const file = shareableFile('Mona Lisa-shapes-seed-1-2048px.png', new Blob(['p'], { type: 'image/png' }));
    expect(file.name).toBe('Mona Lisa-shapes-seed-1-2048px.png');
    expect(file.size).toBe(1);
  });

  it('checks the count and total size limits', () => {
    expect(withinShareLimits([png()])).toBe(true);
    expect(withinShareLimits([])).toBe(false);
    expect(withinShareLimits(Array.from({ length: SHARE_LIMITS.maxFiles }, () => png()))).toBe(true);
    expect(withinShareLimits(Array.from({ length: SHARE_LIMITS.maxFiles + 1 }, () => png()))).toBe(false);
    expect(withinShareLimits([png('big.png', SHARE_LIMITS.maxBytes + 1)])).toBe(false);
  });
});

describe('share files: can this browser share?', () => {
  it('says no where there is no navigator.share or canShare (most desktop Firefox, Linux Chrome)', () => {
    expect(canShareType('image/png', {})).toBe(false);
    expect(canShareType('image/png', { share: async () => {} })).toBe(false);
  });

  it('asks canShare with a sample file of the type', () => {
    const { nav, canShare } = fakeNavigator();
    expect(canShareType('image/gif', nav)).toBe(true);
    const files = (canShare.mock.calls[0] as unknown as [{ files: File[] }])[0].files;
    expect(files[0].type).toBe('image/gif');
    expect(files[0].name).toBe('sample.gif');
  });

  it('says no when canShare says no for the type, or throws, or the type is empty', () => {
    expect(canShareType('video/webm', fakeNavigator('ok', { canShare: false }).nav)).toBe(false);
    const throwing: ShareNavigator = {
      share: async () => {},
      canShare: () => {
        throw new TypeError('bad');
      },
    };
    expect(canShareType('image/png', throwing)).toBe(false);
    expect(canShareType('', fakeNavigator().nav)).toBe(false);
  });
});

describe('share files: one share', () => {
  it('passes the files to navigator.share', async () => {
    const { nav, share } = fakeNavigator();
    const files = [png('a.png'), png('b.png')];
    expect(await shareFiles(files, nav)).toBe('shared');
    expect(share).toHaveBeenCalledWith({ files });
  });

  it('treats AbortError as cancelled and NotAllowedError as needing a tap', async () => {
    expect(await shareFiles([png()], fakeNavigator('AbortError').nav)).toBe('cancelled');
    expect(await shareFiles([png()], fakeNavigator('NotAllowedError').nav)).toBe('needs-tap');
  });

  it('throws other errors', async () => {
    await expect(shareFiles([png()], fakeNavigator('DataError').nav)).rejects.toThrow('no');
  });

  it('refuses before calling share when there is no API, too much, or canShare says no', async () => {
    await expect(shareFiles([png()], {})).rejects.toThrow('cannot share');
    const tooMany = fakeNavigator();
    await expect(shareFiles(Array.from({ length: 11 }, () => png()), tooMany.nav)).rejects.toThrow('at most 10');
    expect(tooMany.share).not.toHaveBeenCalled();
    const refused = fakeNavigator('ok', { canShare: false });
    await expect(shareFiles([png()], refused.nav)).rejects.toThrow('cannot share these files');
    expect(refused.share).not.toHaveBeenCalled();
  });
});

describe('share files: the two-tap flow', () => {
  function setUp(nav: ShareNavigator, made: File[] | null = [png()]) {
    const states: Array<[ShareState, string]> = [];
    const errors: unknown[] = [];
    let key: unknown[] = ['run 1', 2048];
    const prepare = vi.fn(async () => made);
    const flow = createShareFlow({
      prepare,
      key: () => key,
      onChange: (state, message) => states.push([state, message]),
      onError: (error) => errors.push(error),
      navigator: nav,
    });
    return { flow, states, errors, prepare, setKey: (next: unknown[]) => (key = next) };
  }

  it('shares on the first tap when the browser allows it', async () => {
    const { nav, share } = fakeNavigator();
    const { flow, states, errors } = setUp(nav);
    await flow.tap();
    expect(share).toHaveBeenCalledTimes(1);
    expect(flow.state).toBe('idle');
    expect(states.at(-1)).toEqual(['idle', 'Shared picture.png.']);
    expect(errors).toEqual([]);
  });

  it('after NotAllowedError waits for a second tap, which shares the same files at once', async () => {
    const { nav, share } = fakeNavigator('NotAllowedError');
    const { flow, states, errors, prepare } = setUp(nav);
    await flow.tap();
    expect(flow.state).toBe('ready');
    expect(states.at(-1)?.[1]).toContain('Tap the button again');
    expect(errors).toEqual([]);

    // The second tap: share() must be called before anything is awaited.
    share.mockImplementation(() => Promise.resolve());
    const tapped = flow.tap();
    expect(share).toHaveBeenCalledTimes(2);
    await tapped;
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(share.mock.calls[1][0].files).toBe(share.mock.calls[0][0].files);
    expect(flow.state).toBe('idle');
  });

  it('goes straight to the second tap when the browser says the tap has expired', async () => {
    const { nav, share } = fakeNavigator('ok', { active: false });
    const { flow } = setUp(nav);
    await flow.tap();
    expect(share).not.toHaveBeenCalled();
    expect(flow.state).toBe('ready');
    await flow.tap();
    expect(share).toHaveBeenCalledTimes(1);
  });

  it('shows nothing when the visitor closes the sheet, and keeps the files for another tap', async () => {
    const { nav, share } = fakeNavigator('AbortError');
    const { flow, states, errors, prepare } = setUp(nav);
    await flow.tap();
    expect(errors).toEqual([]);
    expect(flow.state).toBe('ready');
    expect(states.every(([, message]) => message === '')).toBe(true);
    await flow.tap();
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(share).toHaveBeenCalledTimes(2);
  });

  it('shows other errors and starts over', async () => {
    const { flow, errors } = setUp(fakeNavigator('DataError').nav);
    await flow.tap();
    expect(errors).toHaveLength(1);
    expect(flow.state).toBe('idle');
  });

  it('shows an error if even the second tap is refused', async () => {
    const { flow, errors } = setUp(fakeNavigator('NotAllowedError').nav);
    await flow.tap();
    expect(errors).toEqual([]);
    await flow.tap();
    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toContain('did not allow');
    expect(flow.state).toBe('idle');
  });

  it('shows an error when making the files fails, and does nothing when there is nothing to share', async () => {
    const { nav, share } = fakeNavigator();
    const failing = createShareFlow({
      prepare: async () => {
        throw new Error('GIF encoder failed');
      },
      key: () => [],
      onChange: () => {},
      onError: (error) => expect(String(error)).toContain('GIF encoder failed'),
      navigator: nav,
    });
    await failing.tap();
    expect(failing.state).toBe('idle');
    const empty = setUp(nav, null);
    await empty.flow.tap();
    expect(empty.flow.state).toBe('idle');
    expect(share).not.toHaveBeenCalled();
  });

  it('drops files made for settings that have changed since', async () => {
    const { nav, share } = fakeNavigator('NotAllowedError');
    const { flow, prepare, setKey } = setUp(nav);
    await flow.tap();
    expect(flow.state).toBe('ready');
    flow.refresh(); // nothing changed
    expect(flow.state).toBe('ready');
    setKey(['run 1', 4096]);
    flow.refresh();
    expect(flow.state).toBe('idle');

    // A tap after a change (without refresh) makes the files again rather than sharing old ones.
    await flow.tap();
    setKey(['run 2', 4096]);
    await flow.tap();
    expect(prepare).toHaveBeenCalledTimes(3);
    expect(share).toHaveBeenCalledTimes(3);
  });

  it('ignores taps while the files are being made', async () => {
    const { nav } = fakeNavigator();
    let finish: (files: File[]) => void = () => {};
    const prepare = vi.fn(() => new Promise<File[]>((resolve) => (finish = resolve)));
    const flow = createShareFlow({ prepare, key: () => [], onChange: () => {}, onError: () => {}, navigator: nav });
    const first = flow.tap();
    expect(flow.state).toBe('preparing');
    await flow.tap();
    expect(prepare).toHaveBeenCalledTimes(1);
    finish([png()]);
    await first;
    expect(flow.state).toBe('idle');
  });
});
