const crypto = require('crypto');
const {
  MIN_CLIP_DURATION_SECONDS,
  getMaxClipCount,
  hasMinimumDuration,
} = require('./video-rules.cjs');
const { FILLER_WORDS, normalizeText } = require('./smart-editing.cjs');

const NORMALIZED_FILLER_WORDS = new Set([...FILLER_WORDS].map((word) => normalizeText(word)));

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
  const isLocalRecommendation = recommendation?.source === 'local-ai';
  return {
    id: crypto.randomUUID(),
    videoId: video.id,
    title: recommendation
      ? `${isLocalRecommendation ? 'Melhor momento' : 'Momento mais assistido'} ${clipNumber}`
      : `Corte ${clipNumber}`,
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
      recommendationReason: recommendation.reason,
      ...(recommendation.prompt ? { recommendationPrompt: recommendation.prompt } : {}),
    } : {}),
    createdAt: new Date().toISOString(),
  };
}

function clampUnit(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  return Math.min(1, Math.max(0, numericValue));
}

function getTranscriptSegments(video) {
  const segments = video.analysis?.tools?.whisperx?.segments;
  return Array.isArray(segments)
    ? segments.filter((segment) => segment && typeof segment === 'object')
    : [];
}

function getFaceSamples(video) {
  const samples = video.analysis?.tools?.mediapipe?.faceSamples;
  return Array.isArray(samples)
    ? samples.filter((sample) => sample && typeof sample === 'object')
    : [];
}

function overlapSeconds(start, end, rangeStart, rangeEnd) {
  return Math.max(0, Math.min(end, rangeEnd) - Math.max(start, rangeStart));
}

function getSegmentText(segment) {
  return normalizeText(segment.text);
}

function getPromptTerms(prompt) {
  return normalizeText(prompt)
    .split(/\s+/)
    .filter((term) => term.length >= 3)
    .filter((term, index, values) => values.indexOf(term) === index);
}

function scoreBestMomentWindow(transcriptSegments, faceSamples, start, end, options = {}) {
  const windowDuration = Math.max(end - start, 1);
  const activeSegments = transcriptSegments
    .map((segment) => {
      const segmentStart = Number(segment.start);
      const segmentEnd = Number(segment.end);
      if (!Number.isFinite(segmentStart) || !Number.isFinite(segmentEnd) || segmentEnd <= segmentStart) {
        return null;
      }

      const overlap = overlapSeconds(segmentStart, segmentEnd, start, end);
      return overlap > 0 ? { segment, overlap, segmentStart, segmentEnd } : null;
    })
    .filter(Boolean);
  const speechRatio = clampUnit(activeSegments.reduce((total, item) => total + item.overlap, 0) / windowDuration);
  const words = activeSegments.reduce((total, item) => {
    const segmentWords = Array.isArray(item.segment.words) && item.segment.words.length > 0
      ? item.segment.words.length
      : getSegmentText(item.segment).split(/\s+/).filter(Boolean).length;
    return total + segmentWords;
  }, 0);

  const hookTerms = /\b(agora|atencao|importante|segredo|erro|resultado|incrivel|melhor|nunca|como|porque|por que|descobri|aprendi|problema|solucao|dica|funciona)\b/gi;
  const hookHits = activeSegments.reduce((total, item) => total + (getSegmentText(item.segment).match(hookTerms) || []).length, 0);
  const punctuationHits = activeSegments.reduce((total, item) => total + (getSegmentText(item.segment).match(/[!?]/g) || []).length, 0);
  const hookScore = clampUnit((hookHits * 0.22) + (punctuationHits * 0.08) + (Math.min(words, 80) / 80) * 0.35);
  const promptTerms = getPromptTerms(options.focusPrompt);
  const promptHits = promptTerms.reduce(
    (total, term) => total + activeSegments.filter((item) => getSegmentText(item.segment).includes(term)).length,
    0,
  );
  const promptScore = promptTerms.length > 0
    ? clampUnit(promptHits / Math.max(promptTerms.length, 1))
    : 0;
  const fillerCount = activeSegments.reduce((total, item) => {
    const segmentWords = Array.isArray(item.segment.words) && item.segment.words.length > 0
      ? item.segment.words
      : [];
    return total + segmentWords.filter((word) => NORMALIZED_FILLER_WORDS.has(normalizeText(word.word || word.text))).length;
  }, 0);
  const fillerPenalty = clampUnit(fillerCount / Math.max(words, 1) * 3);
  const pauseSeconds = activeSegments.slice(1).reduce((total, item, index) => {
    const previous = activeSegments[index];
    return total + Math.max(0, item.segmentStart - previous.segmentEnd);
  }, 0);
  const pausePenalty = clampUnit(pauseSeconds / windowDuration);

  const visualSamples = faceSamples.filter((sample) => {
    const time = Number(sample.timeSeconds);
    return Number.isFinite(time) && time >= start && time < end;
  });
  const sampleCount = Math.max(visualSamples.length, 1);
  const facePresence = visualSamples.filter((sample) => Number(sample.faceCount || 0) > 0).length / sampleCount;
  const motionScore = visualSamples.reduce((total, sample) => total + clampUnit(sample.motion), 0) / sampleCount;
  const centers = visualSamples
    .map((sample) => sample.primaryFace)
    .filter((face) => face && Number.isFinite(Number(face.centerX)) && Number.isFinite(Number(face.centerY)))
    .map((face) => ({ x: Number(face.centerX), y: Number(face.centerY) }));
  const movementScore = centers.length < 2
    ? 0
    : clampUnit(centers.slice(1).reduce((total, center, index) => {
        const previous = centers[index];
        return total + Math.hypot(center.x - previous.x, center.y - previous.y);
      }, 0) / Math.max(centers.length - 1, 1) * 4);
  const visualScore = clampUnit((facePresence * 0.45) + (motionScore * 0.35) + (movementScore * 0.2));
  const promptWeight = promptTerms.length > 0 ? 0.17 : 0;
  const score = Math.round(clampUnit(
    (speechRatio * (0.35 - promptWeight * 0.25)) +
    (hookScore * (0.35 - promptWeight * 0.25)) +
    (visualScore * 0.2) +
    (movementScore * (0.1 - promptWeight * 0.5)) +
    (promptScore * promptWeight) -
    (fillerPenalty * 0.08) -
    (pausePenalty * 0.05),
  ) * 100);

  const signals = {
    speech: Math.round(speechRatio * 100),
    hook: Math.round(hookScore * 100),
    visual: Math.round(visualScore * 100),
    face: Math.round(facePresence * 100),
    prompt: Math.round(promptScore * 100),
    pauses: Math.round(pausePenalty * 100),
    fillers: Math.round(fillerPenalty * 100),
  };

  const reason = [
    `Fala ${signals.speech}%`,
    `gancho ${signals.hook}%`,
    `visual ${signals.visual}%`,
    ...(promptTerms.length > 0 ? [`aderência ao pedido ${signals.prompt}%`] : []),
    ...(signals.pauses > 0 ? [`pausas penalizadas ${signals.pauses}%`] : []),
    ...(signals.fillers > 0 ? [`vícios penalizados ${signals.fillers}%`] : []),
  ].join(', ');

  return {
    score,
    intensity: Math.round(score),
    signals,
    reason: `${reason}.`,
  };
}

function buildLocalBestMomentRecommendations(video, options = {}) {
  const duration = Number(video.durationSeconds || 0);
  const transcriptSegments = getTranscriptSegments(video);
  const faceSamples = getFaceSamples(video);
  if (duration < MIN_CLIP_DURATION_SECONDS || (transcriptSegments.length === 0 && faceSamples.length === 0)) {
    return [];
  }

  const windowDuration = clampNumber(
    options.targetDurationSeconds,
    MIN_CLIP_DURATION_SECONDS,
    Math.max(MIN_CLIP_DURATION_SECONDS, Math.floor(duration)),
    MIN_CLIP_DURATION_SECONDS,
  );
  const maxClipCount = getMaxClipCount(duration);
  const maxStart = Math.max(0, duration - windowDuration);
  const step = maxStart === 0 ? 1 : Math.max(10, Math.min(30, Math.round(windowDuration / 4)));
  const starts = [];
  for (let start = 0; start <= maxStart; start += step) {
    starts.push(start);
  }
  if (starts[starts.length - 1] !== maxStart) {
    starts.push(maxStart);
  }

  const candidates = starts
    .map((start) => {
      const end = Math.min(duration, start + windowDuration);
      const scored = scoreBestMomentWindow(transcriptSegments, faceSamples, start, end, options);
      return {
        id: `local-ai-${Math.round(start * 1000)}`,
        startSeconds: start,
        endSeconds: end,
        durationSeconds: end - start,
        source: 'local-ai',
        rank: 0,
        prompt: String(options.focusPrompt || '').trim() || null,
        ...scored,
      };
    })
    .filter((candidate) => hasMinimumDuration(candidate.startSeconds, candidate.endSeconds))
    .sort((first, second) => second.score - first.score || first.startSeconds - second.startSeconds);

  const selected = [];
  for (const candidate of candidates) {
    const overlaps = selected.some((current) =>
      overlapSeconds(candidate.startSeconds, candidate.endSeconds, current.startSeconds, current.endSeconds) > 0,
    );
    if (overlaps) {
      continue;
    }

    selected.push(candidate);
    if (selected.length >= maxClipCount) {
      break;
    }
  }

  return selected
    .sort((first, second) => first.startSeconds - second.startSeconds)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}

function buildSuggestedClips(video, options = {}) {
  const duration = Number(video.durationSeconds || 0);
  if (!Number.isFinite(duration) || duration < MIN_CLIP_DURATION_SECONDS) {
    return [];
  }

  const mode = ['count', 'recommended', 'best-moments'].includes(options.mode) ? options.mode : 'duration';
  const maxClipCount = getMaxClipCount(duration);

  if (mode === 'recommended' || mode === 'best-moments') {
    const recommendations = mode === 'best-moments'
      ? buildLocalBestMomentRecommendations(video, options)
      : (Array.isArray(video.audienceRecommendations) ? video.audienceRecommendations : []);
    return recommendations
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
  buildLocalBestMomentRecommendations,
  buildSuggestedClips,
};
