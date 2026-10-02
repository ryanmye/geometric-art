import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, createZip } from '../../src/render/zip';

const encode = (text: string) => new TextEncoder().encode(text);

const entries = [
  { name: 'frame-01.png', data: encode('first file contents') },
  { name: 'frame-02.png', data: new Uint8Array(1000).map((_, i) => (i * 7) & 255) },
  { name: 'empty.txt', data: new Uint8Array(0) },
];
const zip = createZip(entries, new Date(2026, 9, 1, 12, 30, 44));
const view = new DataView(zip.buffer);

describe('crc32', () => {
  it('matches the standard check values', () => {
    expect(crc32(encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
    expect(crc32(encode('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
  });
});

describe('createZip', () => {
  it('has a correct end record, central directory and local headers', () => {
    // End of central directory: the last 22 bytes.
    const end = zip.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(3); // entries
    const directorySize = view.getUint32(end + 12, true);
    const directoryStart = view.getUint32(end + 16, true);
    expect(directoryStart + directorySize).toBe(end);

    let pos = directoryStart;
    for (const entry of entries) {
      expect(view.getUint32(pos, true)).toBe(0x02014b50);
      expect(view.getUint16(pos + 10, true)).toBe(0); // stored
      expect(view.getUint32(pos + 16, true)).toBe(crc32(entry.data));
      expect(view.getUint32(pos + 20, true)).toBe(entry.data.length);
      const nameLength = view.getUint16(pos + 28, true);
      expect(new TextDecoder().decode(zip.subarray(pos + 46, pos + 46 + nameLength))).toBe(entry.name);

      // Follow the offset to the local header and the stored bytes.
      const local = view.getUint32(pos + 42, true);
      expect(view.getUint32(local, true)).toBe(0x04034b50);
      expect(view.getUint32(local + 14, true)).toBe(crc32(entry.data));
      const dataStart = local + 30 + view.getUint16(local + 26, true);
      expect(zip.subarray(dataStart, dataStart + entry.data.length)).toEqual(entry.data);
      pos += 46 + nameLength;
    }
    expect(pos).toBe(end);
  });

  it('stores the date and time in DOS format', () => {
    const local = 0;
    const time = view.getUint16(local + 10, true);
    const date = view.getUint16(local + 12, true);
    expect([time >> 11, (time >> 5) & 63, (time & 31) * 2]).toEqual([12, 30, 44]);
    expect([(date >> 9) + 1980, (date >> 5) & 15, date & 31]).toEqual([2026, 10, 1]);
  });

  it.runIf(existsSync('/usr/bin/unzip'))('passes `unzip -t` and extracts the same bytes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zip-test-'));
    const path = join(dir, 'test.zip');
    writeFileSync(path, zip);
    const report = execFileSync('/usr/bin/unzip', ['-t', path]).toString();
    expect(report).toMatch(/No errors detected/);
    const extracted = execFileSync('/usr/bin/unzip', ['-p', path, 'frame-02.png']);
    expect(new Uint8Array(extracted)).toEqual(entries[1].data);
  });
});
