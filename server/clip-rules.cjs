const crypto = require('crypto');
const {
  MIN_CLIP_DURATION_SECONDS,
  getMaxClipCount,
  hasMinimumDuration,
} = require('./video-rules.cjs');

function clampNumber(value, min, max, fallback) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(numberValue)));
}

function formatClipTime(seconds) {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safeSeconds / 60).toString().padStart(2, '0');
  const remainingSeconds = Math.floor(safeSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainingSeconds}`;
}

function createClip(video, start, end, index, recommendation = null) {
  const actualDuration = end - start;
  const clipNumber = String(index + 1).padStart(2, '0');
  return {
    id: crypto.randomUUID(),
    videoId: video.id,
    title: recommendation ? `Momento mais assistido ${clipNumber}` : `Corte ${clipNumber}`,
    sourceName: video.originalName,
    startSeconds: start,
    endSeconds: end,
    durationSeconds: actualDuration,
    duration: formatClipTime(actualDuration),
    range: `${formatClipTime(start)} - ${formatClipTime(end)}`,
    status: 'Pronto',
    shouldCaption: false,
    ...(recommendation ? {
      recommendationScore: recommendation.score,
      recommendationSource: recommendation.source,
    } : {}),
    createdAt: new Date().toISOString(),
  };
}

function buildSuggestedClips(video, options = {}) {
  const duration = Number(video.durationSeconds || 0);
  if (!Number.isFinite(duration) || duration < MIN_CLIP_DURATION_SECONDS) {
    return [];
  }

  const mode = ['count', 'recommended'].includes(options.mode) ? options.mode : 'duration';
  const maxClipCount = getMaxClipCount(duration);

  if (mode === 'recommended') {
    return (Array.isArray(video.audienceRecommendations) ? video.audienceRecommendations : [])
      .filter((recommendation) => {
        const start = Number(recommendation.startSeconds);
        const end = Number(recommendation.endSeconds);
        return hasMinimumDuration(start, end) && end <= duration;
      })
      .slice(0, maxClipCount)
      .map((recommendation, index) => createClip(
        video,
        Number(recommendation.startSeconds),
        Number(recommendation.endSeconds),
        index,
        recommendation,
      ));
  }

  const targetDurationSeconds = clampNumber(
    options.targetDurationSeconds,
    MIN_CLIP_DURATION_SECONDS,
    Math.max(MIN_CLIP_DURATION_SECONDS, Math.floor(duration)),
    MIN_CLIP_DURATION_SECONDS,
  );
  const targetClipCount = clampNumber(options.targetClipCount, 1, maxClipCount, 1);
  const clipCount = mode === 'count'
    ? targetClipCount
    : (() => {
        const fullCount = Math.floor(duration / targetDurationSeconds);
        const remainder = duration - fullCount * targetDurationSeconds;
        if (fullCount === 0) {
          return 1;
        }

        const countWithRemainder = remainder >= MIN_CLIP_DURATION_SECONDS ? fullCount + 1 : fullCount;
        return Math.min(maxClipCount, Math.max(1, countWithRemainder));
      })();

  return Array.from({ length: clipCount }, (_, index) => {
    const start = mode === 'count'
      ? index * (duration / clipCount)
      : index * targetDurationSeconds;
    const end = index === clipCount - 1
      ? duration
      : Math.min(duration, start + (mode === 'count' ? duration / clipCount : targetDurationSeconds));
    return createClip(video, start, end, index);
  });
}

module.exports = {
  MIN_CLIP_DURATION_SECONDS,
  buildSuggestedClips,
};
