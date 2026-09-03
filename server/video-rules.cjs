// Limite tecnico minimo; os cortes podem ser menores ou maiores que 1 minuto.
const MIN_CLIP_DURATION_SECONDS = 3;
const MIN_CLIP_DURATION_MS = MIN_CLIP_DURATION_SECONDS * 1000;

function getMaxClipCount(durationSeconds) {
  const duration = Number(durationSeconds);
  if (!Number.isFinite(duration) || duration < MIN_CLIP_DURATION_SECONDS) {
    return 0;
  }

  return Math.floor(duration / MIN_CLIP_DURATION_SECONDS);
}

function hasMinimumDuration(startSeconds, endSeconds) {
  const start = Number(startSeconds);
  const end = Number(endSeconds);
  return Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start && end - start >= MIN_CLIP_DURATION_SECONDS;
}

module.exports = {
  MIN_CLIP_DURATION_MS,
  MIN_CLIP_DURATION_SECONDS,
  getMaxClipCount,
  hasMinimumDuration,
};
