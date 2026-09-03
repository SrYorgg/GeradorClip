const { MIN_CLIP_DURATION_SECONDS } = require('./video-rules.cjs');

const FILLER_WORDS = new Set([
  'ah',
  'ahm',
  'er',
  'hmm',
  'like',
  'literalmente',
  'né',
  'sabe',
  'tipo',
  'uh',
  'uhm',
  'um',
]);

const BROLL_STOP_WORDS = new Set([
  'a', 'ao', 'aos', 'as', 'com', 'como', 'da', 'das', 'de', 'do', 'dos', 'e',
  'em', 'entre', 'era', 'essa', 'esse', 'esta', 'este', 'eu', 'foi', 'isso',
  'mais', 'mas', 'me', 'mesmo', 'na', 'nas', 'no', 'nos', 'o', 'os', 'para',
  'por', 'que', 'se', 'sem', 'ser', 'sua', 'suas', 'tá', 'tem', 'um', 'uma',
  'umas', 'uns', 'você', 'vocês', 'your', 'the', 'and', 'for', 'with', 'that',
  'this', 'was', 'are', 'you', 'from', 'into', 'about', 'just', 'have', 'has',
]);

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const NORMALIZED_FILLER_WORDS = new Set([...FILLER_WORDS, 'ne'].map((word) => normalizeText(word)));
const NORMALIZED_BROLL_STOP_WORDS = new Set([...BROLL_STOP_WORDS].map((word) => normalizeText(word)));

function getTranscriptSegments(video) {
  const segments = video?.analysis?.tools?.whisperx?.segments;
  if (!Array.isArray(segments)) {
    return [];
  }

  return segments
    .map((segment) => {
      const start = Number(segment?.start);
      const end = Number(segment?.end);
      const text = String(segment?.text || '').trim();
      const words = Array.isArray(segment?.words)
        ? segment.words
          .map((word) => ({
            start: Number(word?.start),
            end: Number(word?.end),
            text: String(word?.word || word?.text || '').trim(),
          }))
          .filter((word) => Number.isFinite(word.start) && Number.isFinite(word.end) && word.end > word.start && word.text)
        : [];

      return { start, end, text, words };
    })
    .filter((segment) => Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.end > segment.start && segment.text)
    .sort((first, second) => first.start - second.start);
}

function mergeRanges(ranges, duration) {
  const sorted = ranges
    .map((range) => ({
      start: Math.max(0, Math.min(duration, Number(range.start) || 0)),
      end: Math.max(0, Math.min(duration, Number(range.end) || 0)),
    }))
    .filter((range) => range.end - range.start >= 0.08)
    .sort((first, second) => first.start - second.start);

  return sorted.reduce((merged, range) => {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end + 0.05) {
      previous.end = Math.max(previous.end, range.end);
      return merged;
    }

    merged.push({ ...range });
    return merged;
  }, []);
}

function buildKeepRanges(duration, removedRanges) {
  const keepRanges = [];
  let cursor = 0;

  removedRanges.forEach((range) => {
    if (range.start > cursor) {
      keepRanges.push({ start: cursor, end: range.start });
    }
    cursor = Math.max(cursor, range.end);
  });

  if (cursor < duration) {
    keepRanges.push({ start: cursor, end: duration });
  }

  return keepRanges.filter((range) => range.end - range.start >= 0.08);
}

function createNoOpEditPlan(duration, reason = null) {
  return {
    enabled: false,
    source: 'whisperx',
    reason,
    originalDurationSeconds: duration,
    editedDurationSeconds: duration,
    removedSilenceSeconds: 0,
    removedFillerSeconds: 0,
    removedRanges: [],
    keepRanges: [{ start: 0, end: duration }],
  };
}

function buildSpeechEditPlan(video, clip, options = {}) {
  const clipStart = Math.max(0, Number(clip?.startSeconds) || 0);
  const clipEnd = Math.max(clipStart, Number(clip?.endSeconds) || clipStart);
  const duration = Math.max(0, clipEnd - clipStart);
  const removeSilence = options.removeSilence === true;
  const removeFillers = options.removeFillers === true;

  if (duration <= 0 || (!removeSilence && !removeFillers)) {
    return createNoOpEditPlan(duration);
  }

  const segments = getTranscriptSegments(video)
    .filter((segment) => segment.end > clipStart && segment.start < clipEnd)
    .map((segment) => ({
      ...segment,
      start: Math.max(clipStart, segment.start) - clipStart,
      end: Math.min(clipEnd, segment.end) - clipStart,
      words: segment.words
        .filter((word) => word.end > clipStart && word.start < clipEnd)
        .map((word) => ({
          ...word,
          start: Math.max(clipStart, word.start) - clipStart,
          end: Math.min(clipEnd, word.end) - clipStart,
        })),
    }))
    .filter((segment) => segment.end > segment.start);

  if (segments.length === 0) {
    return createNoOpEditPlan(duration, 'Nenhuma fala com timestamps foi encontrada para limpar este corte.');
  }

  const removedSilenceRanges = [];
  if (removeSilence) {
    for (let index = 1; index < segments.length; index += 1) {
      const previous = segments[index - 1];
      const current = segments[index];
      const gap = current.start - previous.end;
      if (gap >= 0.9) {
        removedSilenceRanges.push({
          start: previous.end + 0.24,
          end: current.start - 0.24,
        });
      }
    }
  }

  const removedFillerRanges = [];
  if (removeFillers) {
    segments.forEach((segment) => {
      segment.words.forEach((word) => {
        if (NORMALIZED_FILLER_WORDS.has(normalizeText(word.text))) {
          removedFillerRanges.push({
            start: Math.max(0, word.start - 0.06),
            end: Math.min(duration, word.end + 0.06),
          });
        }
      });
    });
  }

  const removedRanges = mergeRanges([...removedSilenceRanges, ...removedFillerRanges], duration);
  const keepRanges = buildKeepRanges(duration, removedRanges);
  const editedDurationSeconds = keepRanges.reduce((total, range) => total + range.end - range.start, 0);

  if (removedRanges.length === 0 || editedDurationSeconds < MIN_CLIP_DURATION_SECONDS) {
    return createNoOpEditPlan(
      duration,
      editedDurationSeconds < MIN_CLIP_DURATION_SECONDS
        ? `A limpeza deixaria o corte com menos de ${MIN_CLIP_DURATION_SECONDS} segundos; o áudio original foi preservado.`
        : 'Nenhum silêncio ou vício de linguagem elegível foi encontrado.',
    );
  }

  const sumDuration = (ranges) => ranges.reduce((total, range) => total + range.end - range.start, 0);
  return {
    enabled: true,
    source: 'whisperx',
    reason: null,
    originalDurationSeconds: duration,
    editedDurationSeconds,
    removedSilenceSeconds: Number(sumDuration(removedSilenceRanges).toFixed(3)),
    removedFillerSeconds: Number(sumDuration(removedFillerRanges).toFixed(3)),
    removedRanges,
    keepRanges,
  };
}

function mapEditedTime(timeSeconds, editPlan) {
  const time = Math.max(0, Number(timeSeconds) || 0);
  if (!editPlan?.enabled) {
    return time;
  }

  let editedTime = 0;
  for (const range of editPlan.keepRanges) {
    if (time >= range.end) {
      editedTime += range.end - range.start;
      continue;
    }

    if (time > range.start) {
      editedTime += Math.min(time, range.end) - range.start;
    }
    return editedTime;
  }

  return editedTime;
}

function overlapsKeepRange(start, end, editPlan) {
  if (!editPlan?.enabled) {
    return true;
  }

  return editPlan.keepRanges.some((range) => end > range.start && start < range.end);
}

function mapTimedEntries(entries, editPlan, options = {}) {
  if (!Array.isArray(entries) || !editPlan?.enabled) {
    return entries;
  }

  return entries
    .filter((entry) => {
      const start = Number(entry.start);
      const end = Number(entry.end);
      return Number.isFinite(start) && Number.isFinite(end) && end > start && overlapsKeepRange(start, end, editPlan);
    })
    .map((entry) => {
      const start = mapEditedTime(entry.start, editPlan);
      const end = mapEditedTime(entry.end, editPlan);
      return {
        ...entry,
        start,
        end: Math.max(start + (options.minimumDuration || 0.08), end),
      };
    })
    .filter((entry) => entry.end > entry.start);
}

function mapFramingTrack(framingTrack, editPlan) {
  if (!Array.isArray(framingTrack) || !editPlan?.enabled) {
    return framingTrack;
  }

  return framingTrack
    .map((keyframe) => ({
      ...keyframe,
      timeMs: Math.round(mapEditedTime(Number(keyframe.timeMs) / 1000, editPlan) * 1000),
    }))
    .filter((keyframe, index, values) => index === 0 || keyframe.timeMs !== values[index - 1].timeMs);
}

function buildBrollSuggestions(video, options = {}) {
  const segments = getTranscriptSegments(video);
  const limit = Math.min(12, Math.max(1, Number(options.limit) || 6));
  const suggestions = [];

  segments.forEach((segment, segmentIndex) => {
    const terms = normalizeText(segment.text)
      .split(/\s+/)
      .filter((term) => term.length >= 5 && !NORMALIZED_BROLL_STOP_WORDS.has(term) && !NORMALIZED_FILLER_WORDS.has(term))
      .filter((term, index, values) => values.indexOf(term) === index);

    if (terms.length === 0) {
      return;
    }

    const selectedTerms = terms.slice(0, 3);
    suggestions.push({
      id: `broll-${Math.round(segment.start * 1000)}-${segmentIndex}`,
      startSeconds: segment.start,
      endSeconds: segment.end,
      title: `Visual para: ${selectedTerms.join(', ')}`,
      prompt: `Imagem ou vídeo de apoio sobre ${selectedTerms.join(', ')}`,
      reason: 'Sugestão criada a partir das palavras-chave da transcrição.',
      source: 'transcript-keywords',
      status: 'suggested',
    });
  });

  return suggestions
    .sort((first, second) => (second.endSeconds - second.startSeconds) - (first.endSeconds - first.startSeconds))
    .slice(0, limit)
    .sort((first, second) => first.startSeconds - second.startSeconds);
}

module.exports = {
  FILLER_WORDS,
  buildBrollSuggestions,
  buildSpeechEditPlan,
  mapEditedTime,
  mapFramingTrack,
  mapTimedEntries,
  normalizeText,
};
