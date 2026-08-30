export const MIN_CLIP_DURATION_SECONDS = 60;
export const MIN_CLIP_DURATION_MS = MIN_CLIP_DURATION_SECONDS * 1000;
export const MAX_VIDEO_DURATION_SECONDS = 60 * 60;
export const MIN_CLIP_COUNT = 1;

export function getMaxClipCount(durationSeconds: number) {
  const duration = Number(durationSeconds);
  if (!Number.isFinite(duration) || duration < MIN_CLIP_DURATION_SECONDS) {
    return 0;
  }

  return Math.floor(duration / MIN_CLIP_DURATION_SECONDS);
}
