// A minimal .zip writer: files are stored as they are, without compression
// ("store" method). That suits PNG files, which are already compressed.
//
// Layout of a zip file (all numbers little-endian):
//   for each file:  local header (30 bytes + name), then the file's bytes
//   then:           central directory, one entry per file (46 bytes + name)
//   then:           end-of-central-directory record (22 bytes)
// Limits: under 65535 files and 4 GB in total (no Zip64), which is plenty here.

export interface ZipEntry {
  /** Path inside the archive, e.g. "frame-01.png". */
  name: string;
  data: Uint8Array;
}

/** CRC-32 (the checksum zip uses), via the usual 256-entry lookup table. */
const CRC_TABLE = makeCrcTable();

function makeCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Build a zip archive. `date` is stored as every file's modification time
 * (zip keeps local time to 2-second precision).
 */
export function createZip(entries: ZipEntry[], date = new Date()): Uint8Array {
  const encoder = new TextEncoder();
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();

  const names = entries.map((entry) => encoder.encode(entry.name));
  const crcs = entries.map((entry) => crc32(entry.data));
  let size = 22;
  entries.forEach((entry, i) => (size += 30 + names[i].length + entry.data.length + 46 + names[i].length));
  if (size > 0xffffffff || entries.length > 0xffff) throw new Error('Too much data for a simple zip file');

  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let pos = 0;
  const u16 = (value: number) => {
    view.setUint16(pos, value, true);
    pos += 2;
  };
  const u32 = (value: number) => {
    view.setUint32(pos, value, true);
    pos += 4;
  };
  const bytes = (value: Uint8Array) => {
    out.set(value, pos);
    pos += value.length;
  };

  // Shared start of both header kinds: version needed, flags, method, time, date, crc, sizes.
  const commonFields = (i: number) => {
    u16(10); // version needed to extract: 1.0
    u16(0x0800); // flags: bit 11 = file name is UTF-8
    u16(0); // compression method: 0 = stored
    u16(time);
    u16(day);
    u32(crcs[i]);
    u32(entries[i].data.length); // compressed size
    u32(entries[i].data.length); // uncompressed size
    u16(names[i].length);
    u16(0); // extra field length
  };

  const offsets: number[] = [];
  entries.forEach((entry, i) => {
    offsets.push(pos);
    u32(0x04034b50); // local file header signature
    commonFields(i);
    bytes(names[i]);
    bytes(entry.data);
  });

  const directoryStart = pos;
  entries.forEach((_entry, i) => {
    u32(0x02014b50); // central directory header signature
    u16(20); // version made by
    commonFields(i);
    u16(0); // comment length
    u16(0); // disk number
    u16(0); // internal attributes
    u32(0); // external attributes
    u32(offsets[i]); // where the local header is
    bytes(names[i]);
  });
  const directorySize = pos - directoryStart;

  u32(0x06054b50); // end of central directory signature
  u16(0); // this disk
  u16(0); // disk where the directory starts
  u16(entries.length); // entries on this disk
  u16(entries.length); // entries in total
  u32(directorySize);
  u32(directoryStart);
  u16(0); // comment length
  return out;
}
