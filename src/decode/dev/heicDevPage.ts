// Standalone check page for the HEIC decoder (see heic-dev.html). Pick or
// drop a file; this shows the decoded image, its dimensions, how long
// decoding took, and whether the native browser decoder or the libheif-js
// fallback produced it.
//
// `window.__heicDevResult` is set after every attempt (success or failure)
// so headless checks can read it without scraping the DOM.

import { decodeHeic } from '../decodeHeic';
import { looksLikeHeic } from '../looksLikeHeic';

export interface HeicDevResult {
  ok: boolean;
  fileName: string;
  fileSize: number;
  looksLikeHeic: boolean;
  width?: number;
  height?: number;
  decoder?: 'native' | 'libheif-js';
  imageCount?: number;
  millis?: number;
  error?: string;
}

declare global {
  interface Window {
    __heicDevResult?: HeicDevResult;
    __heicDevRunning?: boolean;
    /** Headless-check hook: feed in file bytes without a real file picker. */
    __heicDevDecode?: (bytes: ArrayBuffer, name: string, type?: string) => Promise<HeicDevResult>;
  }
}

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} in heic-dev.html`);
  return el as T;
}

async function handleFile(file: File): Promise<HeicDevResult> {
  const log = byId<HTMLPreElement>('log');
  const canvas = byId<HTMLCanvasElement>('preview');
  window.__heicDevRunning = true;
  log.textContent = `Decoding ${file.name} (${file.size} bytes)...`;

  const isHeic = await looksLikeHeic(file);
  const start = performance.now();
  try {
    const result = await decodeHeic(file);
    const millis = performance.now() - start;
    canvas.width = result.width;
    canvas.height = result.height;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.drawImage(result.bitmap, 0, 0);

    const devResult: HeicDevResult = {
      ok: true,
      fileName: file.name,
      fileSize: file.size,
      looksLikeHeic: isHeic,
      width: result.width,
      height: result.height,
      decoder: result.decoder,
      imageCount: result.imageCount,
      millis,
    };
    window.__heicDevResult = devResult;
    log.textContent = [
      `file: ${file.name} (${file.size} bytes)`,
      `looksLikeHeic: ${isHeic}`,
      `decoder: ${result.decoder}`,
      `dimensions: ${result.width} x ${result.height}`,
      `images in container: ${result.imageCount}`,
      `time: ${millis.toFixed(1)} ms`,
    ].join('\n');
    return devResult;
  } catch (error) {
    const millis = performance.now() - start;
    const message = error instanceof Error ? error.message : String(error);
    const failure: HeicDevResult = { ok: false, fileName: file.name, fileSize: file.size, looksLikeHeic: isHeic, millis, error: message };
    window.__heicDevResult = failure;
    log.textContent = `error after ${millis.toFixed(1)} ms: ${message}`;
    return failure;
  } finally {
    window.__heicDevRunning = false;
  }
}

function setUp(): void {
  const input = byId<HTMLInputElement>('file');
  const drop = byId<HTMLElement>('drop');

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = '';
    if (file) void handleFile(file);
  });

  drop.addEventListener('dragover', (event) => {
    event.preventDefault();
  });
  drop.addEventListener('drop', (event) => {
    event.preventDefault();
    const file = event.dataTransfer?.files[0];
    if (file) void handleFile(file);
  });

  window.__heicDevDecode = (bytes, name, type) => handleFile(new File([bytes], name, type ? { type } : undefined));
}

setUp();
