// Record an animation loop to a video file with the browser's MediaRecorder.
//
// The frames are drawn onto a canvas one by one at the chosen speed while the
// recorder captures the canvas, so recording takes as long as the video.

import type { FrameSource } from './types';

/** Formats to try, best first: MP4 (H.264) plays almost everywhere; WebM is the fallback. */
const VIDEO_TYPES = [
  'video/mp4;codecs=avc1.640033',
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

/** The first video format this browser can record, or null if none. */
export function pickVideoType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  return VIDEO_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

/** File extension for a video MIME type. */
export function videoExtension(mimeType: string): string {
  return mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
}

export async function recordVideo(options: {
  frames: FrameSource;
  fps: number;
  /** How many times the loop repeats in the video. */
  loops: number;
  /** Longest side in pixels. */
  size: number;
  onProgress?(secondsDone: number, secondsTotal: number): void;
}): Promise<{ blob: Blob; mimeType: string }> {
  const { frames, fps, loops, size } = options;
  const mimeType = pickVideoType();
  if (!mimeType) {
    throw new Error('This browser cannot record video from a canvas (no supported MediaRecorder format).');
  }
  const scale = size / Math.max(frames.width, frames.height);
  const canvas = document.createElement('canvas');
  // Video encoders want even dimensions.
  canvas.width = Math.round((frames.width * scale) / 2) * 2;
  canvas.height = Math.round((frames.height * scale) / 2) * 2;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const drawScale = canvas.width / frames.width;

  // A frame rate of 0 means "only when asked", so every frame we draw is
  // captured exactly once (with requestFrame) where the browser supports it.
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void };
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: size > 1024 ? 16_000_000 : 6_000_000,
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  const stopped = new Promise<void>((resolve, reject) => {
    recorder.onstop = () => resolve();
    recorder.onerror = (event) => {
      const error = (event as Event & { error?: Error }).error;
      reject(new Error(`Video recording failed: ${error?.message ?? 'unknown error'}`));
    };
  });

  const frameMs = 1000 / fps;
  const totalFrames = frames.count * loops;
  const totalSeconds = totalFrames / fps;

  frames.draw(ctx, 0, drawScale);
  recorder.start();
  const startTime = performance.now();
  for (let k = 0; k < totalFrames; k++) {
    frames.draw(ctx, k % frames.count, drawScale);
    track.requestFrame?.();
    options.onProgress?.(k / fps, totalSeconds);
    // Wait until this frame's time is up, measured from the start so delays do not add up.
    const waitMs = startTime + (k + 1) * frameMs - performance.now();
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, waitMs)));
  }
  recorder.stop();
  await stopped;
  track.stop();
  options.onProgress?.(totalSeconds, totalSeconds);
  return { blob: new Blob(chunks, { type: mimeType.split(';')[0] }), mimeType };
}
