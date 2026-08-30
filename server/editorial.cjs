const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  EDITORIAL_PROMPT_VERSION,
  buildEditorialPrompt,
  createOllamaEditorialAdapter,
} = require('./editorial-ollama.cjs');

const EDITORIAL_VERSION = 1;
const EDITORIAL_MODEL = 'heuristic-editorial-v1';
const EDITORIAL_DIMENSIONS = [
  { id: 'hook', label: 'Gancho inicial', weight: 0.3 },
  { id: 'clarity', label: 'Clareza', weight: 0.25 },
  { id: 'pacing', label: 'Ritmo', weight: 0.25 },
  { id: 'brand-fit', label: 'Aderência à marca', weight: 0.2 },
];

const DEFAULT_EDITORIAL_CONFIG = {
  version: EDITORIAL_VERSION,
  ai: {
    enabled: false,
    provider: 'ollama',
    baseUrl: 'http://localhost:11434',
    model: 'llama3.2:1b',
    timeoutMs: 10000,
    maxTranscriptChars: 6000,
    temperature: 0,
  },
  brand: {
    name: 'ClipCut',
    tone: 'Direto, claro e humano.',
    entries: [],
  },
  evaluation: {
    activeSetId: 'editorial-baseline-v1',
    sets: [
      {
        id: 'editorial-baseline-v1',
        version: '1.0.0',
        name: 'Baseline heurístico',
        cases: [
          {
            id: 'clear-short-hook',
            label: 'Trecho curto com fala e gancho identificável',
            expectedScore: { min: 65, max: 100 },
          },
          {
            id: 'long-low-signal',
            label: 'Trecho longo sem fala detectada',
            expectedScore: { min: 0, max: 60 },
          },
        ],
      },
    ],
  },
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function roundScore(value) {
  return Math.round(clamp(Number(value) || 0, 0, 100));
}

function trimValue(value, maxLength, fallback = '') {
  return String(value || '').trim().slice(0, maxLength) || fallback;
}

function getInteger(value, min, max, fallback) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(numericValue)));
}

function getNumber(value, min, max, fallback) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, numericValue));
}

function normalizeConfig(input) {
  const source = input && typeof input === 'object' ? input : {};
  const sourceAi = source.ai && typeof source.ai === 'object' ? source.ai : {};
  const hasAiEnabled = Object.prototype.hasOwnProperty.call(sourceAi, 'enabled');
  const sourceBrand = source.brand && typeof source.brand === 'object' ? source.brand : {};
  const sourceEvaluation = source.evaluation && typeof source.evaluation === 'object' ? source.evaluation : {};
  const entries = Array.isArray(sourceBrand.entries)
    ? sourceBrand.entries
        .map((entry) => ({
          id: trimValue(entry?.id, 120) || crypto.randomUUID(),
          term: trimValue(entry?.term, 80),
          replacement: trimValue(entry?.replacement, 120),
          kind: entry?.kind === 'forbidden' ? 'forbidden' : 'preferred',
          notes: trimValue(entry?.notes, 240),
        }))
        .filter((entry) => entry.term)
    : [];
  const sets = Array.isArray(sourceEvaluation.sets)
    ? sourceEvaluation.sets
        .map((set) => ({
          id: trimValue(set?.id, 120) || crypto.randomUUID(),
          version: trimValue(set?.version, 30, '1.0.0'),
          name: trimValue(set?.name, 120, 'Conjunto de avaliação'),
          cases: Array.isArray(set?.cases)
            ? set.cases
                .map((evaluationCase) => ({
                  id: trimValue(evaluationCase?.id, 120) || crypto.randomUUID(),
                  label: trimValue(evaluationCase?.label, 200, 'Caso de avaliação'),
                  expectedScore: {
                    min: roundScore(evaluationCase?.expectedScore?.min),
                    max: roundScore(evaluationCase?.expectedScore?.max || 100),
                  },
                }))
                .filter((evaluationCase) => evaluationCase.expectedScore.min <= evaluationCase.expectedScore.max)
            : [],
        }))
        .filter((set) => set.id)
    : [];
  const normalizedSets = sets.length > 0 ? sets : clone(DEFAULT_EDITORIAL_CONFIG.evaluation.sets);
  const requestedActiveSetId = trimValue(sourceEvaluation.activeSetId, 120);
  const activeSetId = normalizedSets.some((set) => set.id === requestedActiveSetId)
    ? requestedActiveSetId
    : normalizedSets[0].id;

  return {
    version: EDITORIAL_VERSION,
    ai: {
      enabled: hasAiEnabled ? sourceAi.enabled === true : process.env.EDITORIAL_AI_ENABLED === 'true',
      provider: 'ollama',
      baseUrl: trimValue(sourceAi.baseUrl, 240, process.env.OLLAMA_BASE_URL || DEFAULT_EDITORIAL_CONFIG.ai.baseUrl),
      model: trimValue(sourceAi.model, 120, process.env.OLLAMA_MODEL || DEFAULT_EDITORIAL_CONFIG.ai.model),
      timeoutMs: getInteger(sourceAi.timeoutMs, 1000, 120000, Number(process.env.EDITORIAL_AI_TIMEOUT_MS) || DEFAULT_EDITORIAL_CONFIG.ai.timeoutMs),
      maxTranscriptChars: getInteger(sourceAi.maxTranscriptChars, 500, 20000, DEFAULT_EDITORIAL_CONFIG.ai.maxTranscriptChars),
      temperature: getNumber(sourceAi.temperature, 0, 1, DEFAULT_EDITORIAL_CONFIG.ai.temperature),
    },
    brand: {
      name: trimValue(sourceBrand.name, 80, DEFAULT_EDITORIAL_CONFIG.brand.name),
      tone: trimValue(sourceBrand.tone, 160, DEFAULT_EDITORIAL_CONFIG.brand.tone),
      entries,
    },
    evaluation: {
      activeSetId,
      sets: normalizedSets,
    },
  };
}

function readConfigFile(configPath) {
  if (!fs.existsSync(configPath)) {
    return clone(DEFAULT_EDITORIAL_CONFIG);
  }

  try {
    return normalizeConfig(JSON.parse(fs.readFileSync(configPath, 'utf8')));
  } catch {
    return clone(DEFAULT_EDITORIAL_CONFIG);
  }
}

function getSeconds(value, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function normalizeSegment(segment) {
  if (!segment || typeof segment !== 'object') {
    return null;
  }

  const start = segment.start !== undefined
    ? getSeconds(segment.start)
    : getSeconds(segment.startMs) / 1000;
  const end = segment.end !== undefined
    ? getSeconds(segment.end)
    : getSeconds(segment.endMs) / 1000;
  const text = trimValue(segment.text || segment.content, 1000);

  if (!text || end <= start) {
    return null;
  }

  return { start, end, text };
}

function getTranscriptSegments(transcriptSegments, clip) {
  const clipStart = Math.max(0, getSeconds(clip?.startSeconds));
  const clipEnd = Math.max(clipStart + 0.1, getSeconds(clip?.endSeconds, clipStart + 1));
  return (Array.isArray(transcriptSegments) ? transcriptSegments : [])
    .map(normalizeSegment)
    .filter((segment) => segment && segment.end > clipStart && segment.start < clipEnd)
    .map((segment) => ({
      ...segment,
      start: Math.max(0, segment.start - clipStart),
      end: Math.min(clipEnd, segment.end) - clipStart,
    }))
    .filter((segment) => segment.end > segment.start);
}

function countWords(text) {
  return trimValue(text, 10000).split(/\s+/).filter(Boolean).length;
}

function scoreWithinRange(value, idealMin, idealMax, softMin, softMax) {
  if (value >= idealMin && value <= idealMax) {
    return 100;
  }

  if (value < idealMin) {
    return roundScore(25 + ((value - softMin) / Math.max(idealMin - softMin, 0.1)) * 75);
  }

  return roundScore(25 + ((softMax - value) / Math.max(softMax - idealMax, 0.1)) * 75);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function applyPreferredTerms(text, entries) {
  return entries
    .filter((entry) => entry.kind === 'preferred' && entry.replacement)
    .reduce((result, entry) => {
      const matcher = new RegExp(`\\b${escapeRegExp(entry.term)}\\b`, 'gi');
      return result.replace(matcher, entry.replacement);
    }, text);
}

function getHeadline(text) {
  const normalized = trimValue(text, 2000).replace(/\s+/g, ' ');
  const firstSentence = normalized.split(/[.!?](?:\s|$)/)[0].trim();
  return (firstSentence || normalized).slice(0, 72).trim();
}

function suggestMetadata({ clip, transcriptSegments, config }) {
  const segments = getTranscriptSegments(transcriptSegments, clip);
  const text = segments.map((segment) => segment.text).join(' ');
  const headline = applyPreferredTerms(getHeadline(text), config.brand.entries);
  const fallbackTitle = trimValue(clip?.title, 80, 'Novo corte');
  const title = headline && /^corte\s+\d+/i.test(fallbackTitle)
    ? `${fallbackTitle} — ${headline}`.slice(0, 100)
    : fallbackTitle;
  const description = applyPreferredTerms(
    text
      ? `${text.slice(0, 220).trim()}${text.length > 220 ? '…' : ''}`
      : 'Descrição pendente de transcrição ou revisão editorial.',
    config.brand.entries,
  );

  return { title, description };
}

function scoreClip({ clip, transcriptSegments, config }) {
  const durationSeconds = Math.max(
    getSeconds(clip?.endSeconds) - getSeconds(clip?.startSeconds),
    0.1,
  );
  const segments = getTranscriptSegments(transcriptSegments, clip);
  const transcriptText = segments.map((segment) => segment.text).join(' ').replace(/\s+/g, ' ').trim();
  const transcriptWordCount = countWords(transcriptText);
  const transcriptAvailable = transcriptWordCount > 0;
  const firstTenSeconds = segments
    .filter((segment) => segment.start < 10)
    .map((segment) => segment.text)
    .join(' ');
  const firstWords = countWords(firstTenSeconds);
  const wordsPerSecond = transcriptWordCount / durationSeconds;
  const speechSeconds = segments.reduce((total, segment) => total + Math.max(0, segment.end - segment.start), 0);
  const coverage = clamp(speechSeconds / durationSeconds, 0, 1);
  const forbiddenMatches = config.brand.entries.filter((entry) =>
    entry.kind === 'forbidden' && new RegExp(`\\b${escapeRegExp(entry.term)}\\b`, 'i').test(transcriptText),
  );
  const preferredMatches = config.brand.entries.filter((entry) =>
    entry.kind === 'preferred' && new RegExp(`\\b${escapeRegExp(entry.term)}\\b`, 'i').test(transcriptText),
  );

  const hookScore = !transcriptAvailable
    ? 42
    : roundScore(40 + Math.min(firstWords, 16) * 2 + (/[?!]/.test(firstTenSeconds) ? 18 : 0) + (/\b(como|por que|atenção|segredo|erro|verdade)\b/i.test(firstTenSeconds) ? 14 : 0));
  const clarityScore = !transcriptAvailable
    ? 45
    : roundScore(45 + Math.min(transcriptWordCount, 80) / 4 + coverage * 30);
  const pacingScore = !transcriptAvailable
    ? 50
    : scoreWithinRange(wordsPerSecond, 1.4, 3.2, 0.4, 5.5);
  const brandScore = config.brand.entries.length === 0
    ? 70
    : roundScore(70 + preferredMatches.length * 10 - forbiddenMatches.length * 35);
  const dimensions = [
    {
      id: 'hook',
      label: 'Gancho inicial',
      score: hookScore,
      weight: 0.3,
      evidence: !transcriptAvailable
        ? 'Sem transcrição para avaliar a abertura.'
        : firstWords > 0
          ? `${firstWords} palavras aparecem nos primeiros 10 segundos${/[?!]/.test(firstTenSeconds) ? ' e há sinal de pergunta ou ênfase' : ''}.`
          : 'A abertura não possui fala detectada.',
    },
    {
      id: 'clarity',
      label: 'Clareza',
      score: clarityScore,
      weight: 0.25,
      evidence: !transcriptAvailable
        ? 'Aguardando transcrição para medir clareza.'
        : `${transcriptWordCount} palavras detectadas em ${Math.round(coverage * 100)}% do trecho.`,
    },
    {
      id: 'pacing',
      label: 'Ritmo',
      score: pacingScore,
      weight: 0.25,
      evidence: !transcriptAvailable
        ? 'Ritmo neutro enquanto a transcrição não estiver disponível.'
        : `${wordsPerSecond.toFixed(1)} palavras por segundo em ${Math.round(durationSeconds)}s.`,
    },
    {
      id: 'brand-fit',
      label: 'Aderência à marca',
      score: brandScore,
      weight: 0.2,
      evidence: forbiddenMatches.length > 0
        ? `${forbiddenMatches.length} termo(s) proibido(s) encontrado(s).`
        : preferredMatches.length > 0
          ? `${preferredMatches.length} termo(s) preferido(s) encontrado(s).`
          : config.brand.entries.length === 0
            ? 'Dicionário de marca ainda sem regras cadastradas.'
            : 'Nenhum conflito de marca detectado.',
    },
  ];
  const total = roundScore(dimensions.reduce((sum, dimension) => sum + dimension.score * dimension.weight, 0));
  const reasons = dimensions
    .slice()
    .sort((first, second) => second.score - first.score)
    .slice(0, 2)
    .map((dimension) => `${dimension.label}: ${dimension.evidence}`);

  if (forbiddenMatches.length > 0) {
    reasons.unshift(`Revise ${forbiddenMatches.map((entry) => entry.term).join(', ')} antes de publicar.`);
  }

  return {
    version: EDITORIAL_VERSION,
    model: EDITORIAL_MODEL,
    confidence: 'heuristic',
    total,
    dimensions,
    reasons: reasons.slice(0, 4),
    inputs: {
      durationSeconds: Number(durationSeconds.toFixed(2)),
      transcriptAvailable,
      transcriptWordCount,
    },
    evaluationSetId: config.evaluation.activeSetId,
    evaluatedAt: new Date().toISOString(),
  };
}

function getModelDimension(rawDimensions, dimensionId) {
  if (Array.isArray(rawDimensions)) {
    return rawDimensions.find((dimension) => dimension?.id === dimensionId);
  }

  return rawDimensions && typeof rawDimensions === 'object'
    ? rawDimensions[dimensionId]
    : null;
}

function containsForbiddenTerm(text, entries) {
  return entries.some((entry) => {
    if (entry.kind !== 'forbidden') {
      return false;
    }

    return new RegExp(`\\b${escapeRegExp(entry.term)}\\b`, 'i').test(text);
  });
}

function normalizeModelAnalysis({ result, clip, transcriptSegments, config, heuristicScore, heuristicSuggestions, evaluatedAt }) {
  const raw = result?.response && typeof result.response === 'object' ? result.response : null;
  const rawScore = raw?.score && typeof raw.score === 'object' ? raw.score : raw;
  const rawDimensions = rawScore?.dimensions;

  if (!raw || !rawDimensions) {
    return null;
  }

  const dimensions = EDITORIAL_DIMENSIONS.map((definition) => {
    const rawDimension = getModelDimension(rawDimensions, definition.id);
    const score = Number(rawDimension?.score);
    if (!Number.isFinite(score)) {
      return null;
    }

    return {
      id: definition.id,
      label: definition.label,
      score: roundScore(score),
      weight: definition.weight,
      evidence: trimValue(rawDimension?.evidence, 320, 'Evidência não fornecida pelo modelo.'),
    };
  });

  if (dimensions.some((dimension) => !dimension)) {
    return null;
  }

  const title = applyPreferredTerms(
    trimValue(raw.title, 100, heuristicSuggestions.title),
    config.brand.entries,
  );
  const description = applyPreferredTerms(
    trimValue(raw.description, 1000, heuristicSuggestions.description),
    config.brand.entries,
  );

  if (!title || !description || containsForbiddenTerm(title, config.brand.entries) || containsForbiddenTerm(description, config.brand.entries)) {
    return null;
  }

  const reasons = (Array.isArray(rawScore?.reasons) ? rawScore.reasons : [])
    .map((reason) => trimValue(reason, 320))
    .filter(Boolean)
    .slice(0, 4);
  const fallbackReasons = dimensions
    .slice()
    .sort((first, second) => second.score - first.score)
    .slice(0, 2)
    .map((dimension) => `${dimension.label}: ${dimension.evidence}`);
  const transcriptText = getTranscriptSegments(transcriptSegments, clip).map((segment) => segment.text).join(' ');
  const model = result.model || config.ai.model;

  return {
    score: {
      version: EDITORIAL_VERSION,
      model: `ollama:${model}`,
      provider: config.ai.provider,
      modelVersion: model,
      promptVersion: EDITORIAL_PROMPT_VERSION,
      confidence: 'local-ai',
      total: roundScore(dimensions.reduce((sum, dimension) => sum + dimension.score * dimension.weight, 0)),
      dimensions,
      reasons: reasons.length ? reasons : fallbackReasons,
      inputs: {
        ...heuristicScore.inputs,
        transcriptChars: transcriptText.length,
      },
      evaluationSetId: config.evaluation.activeSetId,
      evaluatedAt,
      fallback: false,
    },
    suggestions: { title, description },
    source: 'local-ai',
  };
}

function createHeuristicFallback(score, suggestions, reason) {
  return {
    score: {
      ...score,
      fallback: true,
      fallbackReason: reason,
    },
    suggestions,
    source: 'heuristic',
    fallbackReason: reason,
  };
}

function createEditorialService({ dataDir }) {
  const configPath = path.join(dataDir, 'editorial-config.json');
  const ollamaAdapter = createOllamaEditorialAdapter();

  return {
    readConfig() {
      return readConfigFile(configPath);
    },
    saveConfig(input) {
      const config = normalizeConfig(input);
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
      return config;
    },
    scoreClip({ clip, transcriptSegments }) {
      return scoreClip({ clip, transcriptSegments, config: readConfigFile(configPath) });
    },
    suggestMetadata({ clip, transcriptSegments }) {
      return suggestMetadata({ clip, transcriptSegments, config: readConfigFile(configPath) });
    },
    async getProviderStatus() {
      const config = readConfigFile(configPath);
      return ollamaAdapter.getStatus(config.ai);
    },
    async analyzeClip({ clip, transcriptSegments, providerStatus }) {
      const config = readConfigFile(configPath);
      const heuristicScore = scoreClip({ clip, transcriptSegments, config });
      const heuristicSuggestions = suggestMetadata({ clip, transcriptSegments, config });
      const evaluatedAt = new Date().toISOString();

      if (!config.ai.enabled) {
        return createHeuristicFallback(heuristicScore, heuristicSuggestions, 'Modelo local desativado.');
      }

      const status = providerStatus || await ollamaAdapter.getStatus(config.ai);
      if (!status.ready) {
        return createHeuristicFallback(heuristicScore, heuristicSuggestions, status.reason || 'Modelo local indisponível.');
      }

      try {
        const clippedSegments = getTranscriptSegments(transcriptSegments, clip);
        const prompt = buildEditorialPrompt({
          clip,
          transcriptSegments: clippedSegments,
          brand: config.brand,
          maxTranscriptChars: config.ai.maxTranscriptChars,
        });
        const result = await ollamaAdapter.analyze({ config: config.ai, prompt });
        const normalized = normalizeModelAnalysis({
          result,
          clip,
          transcriptSegments,
          config,
          heuristicScore,
          heuristicSuggestions,
          evaluatedAt,
        });

        if (!normalized) {
          throw new Error('Resposta editorial do modelo não passou na validação.');
        }

        return normalized;
      } catch (error) {
        const reason = error?.message || 'Falha ao analisar com o modelo local.';
        console.error(`[editorial] local model failed: ${reason}`);
        return createHeuristicFallback(heuristicScore, heuristicSuggestions, reason);
      }
    },
  };
}

module.exports = {
  DEFAULT_EDITORIAL_CONFIG,
  createEditorialService,
  EDITORIAL_PROMPT_VERSION,
  normalizeConfig,
  scoreClip,
  suggestMetadata,
};
