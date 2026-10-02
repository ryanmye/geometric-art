import { describe, expect, it } from 'vitest';
import { exportEntryName, exportStems, safeStem } from '../../src/ui/photos/fileNames';
import { createPhotoList } from '../../src/ui/photos/photoList';
import { differentSettingsNote, resultKind } from '../../src/ui/photos/storedResult';
import { maskFingerprint, planBatch, resultKey, type RunSettingsForKey } from '../../src/ui/photos/batchPlan';

describe('export file names', () => {
  it('keeps names from any script and replaces only what is unsafe', () => {
    expect(safeStem('Été à Paris (2).JPG')).toBe('Été à Paris (2)');
    expect(safeStem('IMG_0042.heic')).toBe('IMG_0042');
    expect(safeStem('日本語.jpg')).toBe('日本語');
    expect(safeStem('中文.png')).toBe('中文');
    expect(safeStem('ß.png')).toBe('ß');
    expect(safeStem('😀.png')).toBe('😀');
    expect(safeStem('emoji-😀-éè中文.png')).toBe('emoji-😀-éè中文');
    expect(safeStem('has spaces here.png')).toBe('has spaces here');
    expect(safeStem('a.tar.gz.png')).toBe('a.tar.gz');
    // NFD (as macOS file names often are) becomes NFC.
    expect(safeStem('Cafe\u0301.jpg')).toBe('Caf\u00e9');
  });

  it('removes paths, control characters, Windows-forbidden characters and dots', () => {
    expect(safeStem('../../etc/passwd.png')).toBe('etc-passwd');
    expect(safeStem('back\\slash\\name.png')).toBe('back-slash-name');
    expect(safeStem('C:\\Windows\\evil.png')).toBe('C-Windows-evil');
    expect(safeStem('/abs/path.png')).toBe('abs-path');
    expect(safeStem('a<b>c:d"e|f?g*h.png')).toBe('a-b-c-d-e-f-g-h');
    expect(safeStem('tab\there.png')).toBe('tab here');
    expect(safeStem('new\nline.png')).toBe('new line');
    expect(safeStem('\u202Egnp.exe.png')).toBe('gnp.exe'); // right-to-left override
    expect(safeStem('a..b.png')).toBe('a.b');
    expect(safeStem('..leading-trailing-dots..')).toBe('leading-trailing-dots');
    expect(safeStem('  leading-and-trailing-spaces  .png')).toBe('leading-and-trailing-spaces');
  });

  it('guards Windows device names and keeps the length in bytes', () => {
    expect(safeStem('CON.png')).toBe('_CON');
    expect(safeStem('aux.tar.gz')).toBe('_aux.tar');
    expect(safeStem('console.png')).toBe('console');
    expect(safeStem('x'.repeat(300) + '.png')).toBe('x'.repeat(64));
    const long = safeStem('日'.repeat(50));
    expect(long).toBe('日'.repeat(21)); // 3 bytes each
    expect(safeStem('👩‍💻'.repeat(30)).length % '👩‍💻'.length).toBe(0); // never cut inside an emoji
  });

  it('gives nothing for names with nothing usable', () => {
    for (const name of ['', '.', '....', '  .png', '???', '\u0000']) expect(safeStem(name)).toBe('');
  });

  it('makes stems unique ignoring case, without taking another photo\'s name', () => {
    expect(exportStems(['a', 'b', 'a', 'A'])).toEqual(['a', 'b', 'a (2)', 'A (3)']);
    expect(exportStems(['photo', 'photo (2)', 'photo'])).toEqual(['photo', 'photo (2)', 'photo (3)']);
    expect(exportStems(['ß.png', 'SS.png'])).toEqual(['ß', 'SS (2)']);
    // Fallbacks never take the name of a photo really called "untitled".
    expect(exportStems(['....', 'untitled.png', '?'])).toEqual(['untitled (2)', 'untitled', 'untitled (3)']);
    expect(exportEntryName('Mona Lisa', 'polygons', 7, 'svg')).toBe('Mona Lisa-polygons-seed-7.svg');
  });

  it('handles the tester\'s awkward names', () => {
    const names = [
      'twin.jpg', 'twin.jpg', 'TWIN.JPG', 'Twin.Jpg', 'has spaces here.png', 'back\\slash\\name.png',
      'emoji-😀-éè中文.png', '中文.png', '日本語.jpg', '😀.png', 'x'.repeat(250) + '.png', 'no-extension-at-all',
      '....', 'CON.png', 'aux.jpg', '  leading-and-trailing-spaces  .png', '..leading-trailing-dots..', 'a..b.png',
      'photo.jpg', 'photo-2.jpg', 'ß.png', 'a.tar.gz.png', 'tab\there.png', 'weird/path\\like\\name.png',
      '../../etc/passwd.png', '/abs/path.png', 'C:\\Windows\\evil.png', 'x'.repeat(300) + '.png',
      'y'.repeat(300) + 'A.png', 'y'.repeat(300) + 'B.png', '', '.', 'nul', '\u202Egnp.exe.png', 'new\nline.png',
      'Pasted image',
    ];
    const stems = exportStems(names);
    const keys = stems.map((stem) => stem.toUpperCase().toLowerCase());
    expect(new Set(keys).size).toBe(names.length);
    for (const stem of stems) {
      const entry = exportEntryName(stem, 'polygons', 1, 'svg');
      expect(entry).not.toMatch(/[\\/<>:"|?*\p{C}]/u);
      expect(entry).not.toContain('..');
      expect(new TextEncoder().encode(entry).length).toBeLessThan(255);
      expect(entry.split('.')[0].toLowerCase()).not.toMatch(/^(con|prn|aux|nul|com\d|lpt\d)$/);
    }
    expect(stems.slice(0, 4)).toEqual(['twin', 'twin (2)', 'TWIN (3)', 'Twin (4)']);
    expect(stems[names.indexOf('photo-2.jpg')]).toBe('photo-2');
    expect(stems[names.indexOf('日本語.jpg')]).toBe('日本語');
    expect(stems.filter((stem) => stem.startsWith('untitled'))).toEqual(['untitled', 'untitled (2)', 'untitled (3)']);
  });
});

describe('photo list', () => {
  it('adds up to the cap, selects, and moves the current photo to a neighbour on removal', () => {
    const list = createPhotoList<string>(3);
    const first = list.add([{ name: 'a', extra: 'A' }, { name: 'b', extra: 'B' }]);
    expect(first.added.map((p) => p.id)).toEqual([1, 2]);
    expect(list.current).toBeNull();
    const second = list.add([{ name: 'c', extra: 'C' }, { name: 'd', extra: 'D' }]);
    expect(second.added.map((p) => p.name)).toEqual(['c']);
    expect(second.overCap).toBe(1);
    expect(list.select(2)).toBe(true);
    expect(list.select(99)).toBe(false);
    expect(list.current?.name).toBe('b');
    // Removing the current photo selects the next one; removing the last selects the previous.
    list.remove(2);
    expect(list.current?.name).toBe('c');
    list.remove(3);
    expect(list.current?.name).toBe('a');
    // Removing another photo leaves the current one alone; ids are never reused.
    list.add([{ name: 'e', extra: 'E' }]);
    expect(list.photos.map((p) => p.id)).toEqual([1, 4]);
    list.remove(4);
    expect(list.current?.name).toBe('a');
    expect(list.clear().map((p) => p.name)).toEqual(['a']);
    expect(list.current).toBeNull();
    expect(list.photos).toEqual([]);
  });

  it('allows the same name twice', () => {
    const list = createPhotoList<null>(5);
    list.add([{ name: 'same.jpg', extra: null }, { name: 'same.jpg', extra: null }]);
    expect(list.photos).toHaveLength(2);
  });
});

describe('Run all planning', () => {
  const settings: RunSettingsForKey = { style: 'shapes', output: 'single', config: { seed: 1 }, animation: null, workingSize: 256, detail: 0.75 };

  it('gives the same key only for the same settings and mask', () => {
    const mask = new Uint8Array([0, 255, 3]);
    expect(resultKey(settings, null)).toBe(resultKey({ ...settings }, null));
    expect(resultKey(settings, null)).not.toBe(resultKey({ ...settings, detail: 0.5 }, null));
    expect(resultKey(settings, mask)).not.toBe(resultKey(settings, null));
    expect(resultKey(settings, mask)).not.toBe(resultKey(settings, new Uint8Array([0, 255, 4])));
    expect(maskFingerprint(mask)).toBe(maskFingerprint(new Uint8Array([0, 255, 3])));
  });

  it('runs photos in list order and skips those already finished with the same key', () => {
    const now = 'K';
    const candidates = [
      { id: 1, resultKey: 'K', keyNow: now }, // finished with these settings
      { id: 2, resultKey: null, keyNow: now }, // no result
      { id: 3, resultKey: 'old', keyNow: now }, // finished with other settings
      { id: 4, resultKey: 'K', keyNow: now },
    ];
    expect(planBatch(candidates, false)).toEqual({ run: [2, 3], skipped: [1, 4] });
    expect(planBatch(candidates, true)).toEqual({ run: [1, 2, 3, 4], skipped: [] });
  });
});

import { skipReason, skippedMessage } from '../../src/ui/photos/skipReason';

describe('skipped files', () => {
  it('explains each kind of failure in plain words', () => {
    expect(skipReason(new Error('That file does not look like an image (text/plain).'))).toBe('not an image');
    expect(skipReason(new Error('HEIC: Could not load the HEIC decoder (HTTP 404).'))).toMatch(/decoder could not be downloaded/);
    expect(skipReason(new Error('HEIC: Failed to fetch dynamically imported module: /x.js'))).toMatch(/decoder could not be downloaded/);
    expect(skipReason(new Error('HEIC: This HEIC photo could not be decoded — it may use a codec this decoder does not support.'))).toBe(
      'a HEIC photo that is damaged or of a kind this decoder cannot read',
    );
    expect(skipReason(new Error('HEIC: That file could not be read as HEIC/HEIF — it may be corrupt'))).toBe('a damaged HEIC photo');
    // A network failure outside the HEIC path is not blamed on the HEIC decoder.
    expect(skipReason(new TypeError('Failed to fetch'))).toBe('could not be read as an image');
    expect(skipReason(new Error('Could not read that image. Try a JPEG or PNG.'))).toBe('could not be read as an image');
  });

  it('names every skipped file with its reason', () => {
    expect(skippedMessage([])).toBe('');
    expect(skippedMessage([{ name: 'a.txt', reason: 'not an image' }])).toBe('Skipped 1 file: a.txt (not an image).');
    expect(
      skippedMessage([
        { name: 'a.txt', reason: 'not an image' },
        { name: 'b.heic', reason: 'a damaged HEIC photo' },
      ]),
    ).toBe('Skipped 2 files: a.txt (not an image), b.heic (a damaged HEIC photo).');
  });
});

import { batchSummary } from '../../src/ui/photos/batchPlan';

describe('Run all summary', () => {
  it('names every failed photo with its reason', () => {
    expect(batchSummary(3, 0, [])).toBe('Run all finished: 3 photos made.');
    expect(batchSummary(1, 2, [])).toBe('Run all finished: 1 photo made, 2 skipped.');
    expect(
      batchSummary(2, 0, [
        { name: 'a.jpg', reason: 'Out of memory' },
        { name: 'b.png', reason: 'Too small' },
      ]),
    ).toBe('Run all finished: 2 photos made, 2 failed: a.jpg (Out of memory); b.png (Too small).');
  });
});

describe('stored result note', () => {
  it('says plainly when a shown result differs from the chosen style or output', () => {
    const result = { style: 'polygons' as const, output: 'animation' as const };
    expect(differentSettingsNote(result, { style: 'polygons', output: 'animation' })).toBeNull();
    expect(differentSettingsNote(result, { style: 'shapes', output: 'animation' })).toBe(
      'Shown: a result made as Polygon mosaic, seed animation. The settings now say Overlapping shapes, seed animation; Start makes a new one.',
    );
    expect(resultKind({ style: 'mesh', output: 'single' })).toBe('Triangle mesh, single picture');
  });
});
