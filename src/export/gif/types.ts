// Options and small shared types for the GIF encoder. Kept separate so the
// other files (palette, quantise, lzw, writer) don't need to import the
// public entry point.

/** Options for encodeGif(). Every field is optional; see DEFAULT_GIF_OPTIONS. */
export interface GifOptions {
  /**
   * How long each frame is shown, in milliseconds. GIF only stores delay in
   * hundredths of a second, so this is rounded to the nearest 10ms. Most
   * browsers/players treat a stored delay under ~20ms (2 centiseconds) as if
   * it were about 100ms, so very short delays will not play as fast as
   * asked.
   */
  delayMs?: number;
  /** Times the animation repeats. 0 means forever. Default: 0 (forever). */
  loop?: number;
  /** Largest number of palette colours to use, up to 256. Default: 256. */
  maxColors?: number;
  /**
   * 'global' builds one palette shared by every frame (default, and
   * recommended for this project: it keeps colours from flickering between
   * frames of the same animation). 'local' builds a separate palette per
   * frame, which can look better for frames with very different colours but
   * costs more bytes and can shimmer.
   */
  palette?: 'global' | 'local';
  /**
   * Floyd-Steinberg error-diffusion dithering when mapping pixels to the
   * palette. Off by default (flat shapes already have few colours per
   * region, so dithering mostly adds noise).
   */
  dither?: boolean;
}

export interface ResolvedGifOptions {
  delayMs: number;
  loop: number;
  maxColors: number;
  palette: 'global' | 'local';
  dither: boolean;
}

export const DEFAULT_GIF_OPTIONS: ResolvedGifOptions = {
  delayMs: 125,
  loop: 0,
  maxColors: 256,
  palette: 'global',
  dither: false,
};

export function resolveOptions(options?: GifOptions): ResolvedGifOptions {
  return {
    delayMs: options?.delayMs ?? DEFAULT_GIF_OPTIONS.delayMs,
    loop: options?.loop ?? DEFAULT_GIF_OPTIONS.loop,
    maxColors: options?.maxColors ?? DEFAULT_GIF_OPTIONS.maxColors,
    palette: options?.palette ?? DEFAULT_GIF_OPTIONS.palette,
    dither: options?.dither ?? DEFAULT_GIF_OPTIONS.dither,
  };
}

/** One RGB palette colour, 0-255 each. */
export interface PaletteColor {
  r: number;
  g: number;
  b: number;
}
