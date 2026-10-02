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

/** Unix permissions stored with each file (a regular file, readable by all, writable by its owner). */
const UNIX_FILE_MODE = 0o100644;

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
 * Build a zip archive as a list of parts: small header pieces and each file's
 * own bytes (not copied). Joined in order they are the zip file. Handing the
 * parts straight to `new Blob(parts)` avoids building one huge array for a
 * large zip. `date` is stored as every file's modification time (zip keeps
 * local time to 2-second precision).
 */
export function createZipParts(entries: ZipEntry[], date = new Date()): Uint8Array[] {
  const encoder = new TextEncoder();
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();

  const names = entries.map((entry) => encoder.encode(entry.name));
  const crcs = entries.map((entry) => crc32(entry.data));
  let size = 22;
  entries.forEach((entry, i) => (size += 30 + names[i].length + entry.data.length + 46 + names[i].length));
  if (size > 0xffffffff || entries.length > 0xffff) throw new Error('Too much data for a simple zip file');

  const parts: Uint8Array[] = [];
  let offset = 0; // bytes written so far, across all parts

  /** A small writer for one header piece of the given length. */
  function piece(length: number) {
    const bytes = new Uint8Array(length);
    const view = new DataView(bytes.buffer);
    let pos = 0;
    return {
      u16(value: number) {
        view.setUint16(pos, value, true);
        pos += 2;
      },
      u32(value: number) {
        view.setUint32(pos, value, true);
        pos += 4;
      },
      bytes(value: Uint8Array) {
        bytes.set(value, pos);
        pos += value.length;
      },
      finish() {
        parts.push(bytes);
        offset += bytes.length;
      },
    };
  }

  // Shared start of both header kinds: version needed, flags, method, time, date, crc, sizes.
  const commonFields = (w: ReturnType<typeof piece>, i: number) => {
    w.u16(10); // version needed to extract: 1.0
    w.u16(0x0800); // flags: bit 11 = file name is UTF-8
    w.u16(0); // compression method: 0 = stored
    w.u16(time);
    w.u16(day);
    w.u32(crcs[i]);
    w.u32(entries[i].data.length); // compressed size
    w.u32(entries[i].data.length); // uncompressed size
    w.u16(names[i].length);
    w.u16(0); // extra field length
  };

  const offsets: number[] = [];
  entries.forEach((entry, i) => {
    offsets.push(offset);
    const local = piece(30 + names[i].length);
    local.u32(0x04034b50); // local file header signature
    commonFields(local, i);
    local.bytes(names[i]);
    local.finish();
    parts.push(entry.data); // the file itself, as it is
    offset += entry.data.length;
  });

  const directoryStart = offset;
  entries.forEach((_entry, i) => {
    const central = piece(46 + names[i].length);
    central.u32(0x02014b50); // central directory header signature
    // Made by: Unix (3), zip 2.0. With a Unix origin, unzip tools that do not
    // read the UTF-8 flag (such as the one in macOS) take the name's bytes as
    // they are instead of converting them from an old DOS code page, so
    // non-Latin names come out right everywhere.
    central.u16((3 << 8) | 20);
    commonFields(central, i);
    central.u16(0); // comment length
    central.u16(0); // disk number
    central.u16(0); // internal attributes
    central.u32(UNIX_FILE_MODE * 0x10000); // external attributes: an ordinary file, rw-r--r--
    central.u32(offsets[i]); // where the local header is
    central.bytes(names[i]);
    central.finish();
  });
  const directorySize = offset - directoryStart;

  const end = piece(22);
  end.u32(0x06054b50); // end of central directory signature
  end.u16(0); // this disk
  end.u16(0); // disk where the directory starts
  end.u16(entries.length); // entries on this disk
  end.u16(entries.length); // entries in total
  end.u32(directorySize);
  end.u32(directoryStart);
  end.u16(0); // comment length
  end.finish();
  return parts;
}

/** Build a zip archive in one array (the parts from createZipParts, joined). */
export function createZip(entries: ZipEntry[], date = new Date()): Uint8Array {
  const parts = createZipParts(entries, date);
  let size = 0;
  for (const part of parts) size += part.length;
  const out = new Uint8Array(size);
  let pos = 0;
  for (const part of parts) {
    out.set(part, pos);
    pos += part.length;
  }
  return out;
}
