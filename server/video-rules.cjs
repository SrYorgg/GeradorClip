const MIN_CLIP_DURATION_SECONDS = 60;
const MIN_CLIP_DURATION_MS = MIN_CLIP_DURATION_SECONDS * 1000;
const MAX_VIDEO_DURATION_SECONDS = 60 * 60;

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
  MAX_VIDEO_DURATION_SECONDS,
  MIN_CLIP_DURATION_MS,
  MIN_CLIP_DURATION_SECONDS,
  getMaxClipCount,
  hasMinimumDuration,
};
