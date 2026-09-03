// Limite tecnico minimo; os cortes podem ser menores ou maiores que 1 minuto.
export const MIN_CLIP_DURATION_SECONDS = 3;
export const MIN_CLIP_DURATION_MS = MIN_CLIP_DURATION_SECONDS * 1000;
export const MIN_CLIP_COUNT = 1;
export const MAX_VIDEO_FILE_SIZE_BYTES = 1024 * 1024 * 1024;
export const MAX_IMPORT_URL_LENGTH = 2048;

export function getMaxClipCount(durationSeconds: number) {
  const duration = Number(durationSeconds);
  if (!Number.isFinite(duration) || duration < MIN_CLIP_DURATION_SECONDS) {
    return 0;
  }

  return Math.floor(duration / MIN_CLIP_DURATION_SECONDS);
}
