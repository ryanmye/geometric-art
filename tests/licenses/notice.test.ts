// Keeps public/licenses/NOTICE.txt true to what the build actually serves:
// builds the site into a temporary folder and checks the notice's claims
// against the output and the installed libheif-js package.

import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const pkgDir = join(root, 'node_modules/libheif-js');
const notice = readFileSync(join(root, 'public/licenses/NOTICE.txt'), 'utf8');
const installedVersion: string = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version;
const workerSource = readFileSync(join(root, 'src/decode/heic.worker.ts'), 'utf8');
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

describe('NOTICE.txt against the installed package', () => {
  it('names the installed libheif-js version everywhere it names one', () => {
    const named = [...notice.matchAll(/libheif-js (\d+\.\d+\.\d+)/g)].map((match) => match[1]);
    expect(named.length).toBeGreaterThan(0);
    for (const version of named) expect(version).toBe(installedVersion);
  });

  it('names the package files the worker actually imports, and they exist', () => {
    for (const path of ['libheif-wasm/libheif.wasm', 'libheif-wasm/libheif.js']) {
      expect(notice).toContain(path);
      expect(workerSource).toContain(`'libheif-js/${path}`);
      expect(() => readFileSync(join(pkgDir, path))).not.toThrow();
    }
  });

  it('serves licence texts copied unchanged from the package', () => {
    const copy = (name: string) => readFileSync(join(root, 'public/licenses', name));
    expect(copy('libheif-js-LICENSE.txt').equals(readFileSync(join(pkgDir, 'LICENSE')))).toBe(true);
    expect(copy('libheif-LICENSE.txt').equals(readFileSync(join(pkgDir, 'libheif-wasm/LICENSE')))).toBe(true);
  });
});

describe('NOTICE.txt against the built site', () => {
  let outDir = '';
  let assets: string[] = [];
  beforeAll(async () => {
    outDir = mkdtempSync(join(tmpdir(), 'geometric-art-notice-'));
    await build({ root, mode: 'production', logLevel: 'silent', build: { outDir, emptyOutDir: true } });
    assets = readdirSync(join(outDir, 'assets'));
  }, 120_000);
  afterAll(() => {
    if (outDir) rmSync(outDir, { recursive: true, force: true });
  });

  it('serves exactly one wasm file, byte for byte the package file', () => {
    const wasm = assets.filter((name) => name.endsWith('.wasm'));
    expect(wasm).toHaveLength(1);
    expect(wasm[0]).toMatch(/^libheif-[\w-]+\.wasm$/);
    expect(sha256(readFileSync(join(outDir, 'assets', wasm[0])))).toBe(sha256(readFileSync(join(pkgDir, 'libheif-wasm/libheif.wasm'))));
  });

  it("serves the glue only inside this site's own worker bundle, as the notice says", () => {
    const workers = assets.filter((name) => /^heic\.worker-[\w-]+\.js$/.test(name));
    expect(workers).toHaveLength(1);
    const built = readFileSync(join(outDir, 'assets', workers[0]), 'utf8');
    const glue = readFileSync(join(pkgDir, 'libheif-wasm/libheif.js'), 'utf8');
    expect(built).not.toBe(glue);
    // This project's own worker code…
    expect(built).toContain('Could not load the HEIC decoder');
    // …and the package's glue (its embind wrapper class).
    expect(built).toContain('HeifDecoder');
    expect(notice).toContain('assets/heic.worker-<hash>.js is not a file from the package');
  });

  it('publishes the notice and licence texts unchanged', () => {
    for (const name of ['NOTICE.txt', 'libheif-js-LICENSE.txt', 'libheif-LICENSE.txt']) {
      expect(readFileSync(join(outDir, 'licenses', name)).equals(readFileSync(join(root, 'public/licenses', name)))).toBe(true);
    }
  });
});
