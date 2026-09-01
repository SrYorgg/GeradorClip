import type { CaptionPosition, CaptionSettings, CaptionTrack } from '../features/editor/domain/editor.types';

export const DEFAULT_CAPTION_SETTINGS: CaptionSettings = {
  mode: 'automatic',
  manualText: '',
  corrections: '',
  font: 'geist',
  position: 'bottom',
  displayMode: 'block',
  effect: 'none',
  language: 'pt-BR',
  positionX: 50,
  positionY: 86,
  maxWidthPct: 84,
  fontSize: 42,
  textColor: '#FFFFFF',
  highlightColor: '#73DDBD',
  outlineColor: '#111111',
  outlineWidth: 2,
  backgroundColor: '#000000',
  backgroundOpacity: 0.6,
};

const POSITION_Y: Record<CaptionPosition, number> = {
  top: 12,
  middle: 50,
  bottom: 86,
};

export function getCaptionSettings(settings?: CaptionSettings | null): CaptionSettings {
  const position = settings?.position || DEFAULT_CAPTION_SETTINGS.position || 'bottom';

  return {
    ...DEFAULT_CAPTION_SETTINGS,
    position,
    positionX: settings?.positionX ?? DEFAULT_CAPTION_SETTINGS.positionX,
    positionY: settings?.positionY ?? POSITION_Y[position],
    ...settings,
  };
}

export function getCaptionTrackText(track?: CaptionTrack | null) {
  return (track?.cues || [])
    .map((cue) => cue.text.trim())
    .filter(Boolean)
    .join('\n');
}

export function getCaptionBackgroundColor(settings: Pick<CaptionSettings, 'backgroundColor' | 'backgroundOpacity'>) {
  const color = /^#[0-9a-f]{6}$/i.test(String(settings.backgroundColor || ''))
    ? String(settings.backgroundColor)
    : '#000000';
  const opacity = Math.min(1, Math.max(0, Number(settings.backgroundOpacity ?? 0.6)));
  return `rgba(${parseInt(color.slice(1, 3), 16)}, ${parseInt(color.slice(3, 5), 16)}, ${parseInt(color.slice(5, 7), 16)}, ${opacity})`;
}

function tokenizeCaptionText(text: string) {
  return text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
}

function retimeCaptionWords(words: CaptionTrack['words'], startMs: number, endMs: number, tokens: string[]) {
  if (!words || words.length === 0) {
    return words;
  }
  if (tokens.length === 0) {
    return [];
  }

  const existingWords = words;
  const durationMs = Math.max(endMs - startMs, tokens.length);
  return tokens.map((token, index) => {
    const wordStartMs = startMs + Math.round((durationMs * index) / tokens.length);
    const wordEndMs = index === tokens.length - 1
      ? endMs
      : startMs + Math.round((durationMs * (index + 1)) / tokens.length);
    return {
      id: existingWords[index]?.id || `word-${startMs}-${index}`,
      text: token,
      startMs: wordStartMs,
      endMs: Math.max(wordStartMs + 1, wordEndMs),
      ...(existingWords[index]?.confidence === undefined ? {} : { confidence: existingWords[index].confidence }),
      ...(existingWords[index]?.speakerId === undefined ? {} : { speakerId: existingWords[index].speakerId }),
    };
  });
}

export function updateCaptionCueText(track: CaptionTrack, cueId: string, text: string): CaptionTrack {
  const cue = track.cues?.find((currentCue) => currentCue.id === cueId);
  if (!cue) {
    return track;
  }

  const nextText = text.replace(/\s+/g, ' ');
  const cueWords = (track.words || []).filter(
    (word) => word.endMs > cue.startMs && word.startMs < cue.endMs,
  );
  const tokens = tokenizeCaptionText(nextText);
  const nextWords = cueWords.length === tokens.length
    ? cueWords.map((word, index) => ({ ...word, text: tokens[index] }))
    : retimeCaptionWords(cueWords, cue.startMs, cue.endMs, tokens) || [];
  const cueWordIds = new Set(cueWords.map((word) => word.id));

  return {
    ...track,
    cues: (track.cues || []).map((currentCue) => currentCue.id === cueId
      ? { ...currentCue, text: nextText }
      : currentCue),
    words: [
      ...(track.words || []).filter((word) => !cueWordIds.has(word.id)),
      ...nextWords,
    ].sort((left, right) => left.startMs - right.startMs),
  };
}
