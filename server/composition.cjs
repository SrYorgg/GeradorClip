const crypto = require('crypto');
const { MIN_CLIP_DURATION_MS, MIN_CLIP_DURATION_SECONDS, hasMinimumDuration } = require('./video-rules.cjs');

const CANVAS = { width: 1080, height: 1920, fps: 30 };

const DEFAULT_LAYOUT = {
  id: 'vertical-main',
  name: 'Vertical 9:16',
  preset: 'vertical',
  background: '#05050a',
  showSafeArea: true,
  regions: [
    {
      id: 'main',
      name: 'Video principal',
      xPct: 0,
      yPct: 0,
      widthPct: 100,
      heightPct: 100,
      visible: true,
    },
  ],
};

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeLayoutConfig(layoutConfig) {
  const requestedCanvas = layoutConfig?.canvas;
  const canvas = requestedCanvas &&
    Number.isFinite(Number(requestedCanvas.width)) &&
    Number.isFinite(Number(requestedCanvas.height)) &&
    Number.isFinite(Number(requestedCanvas.fps))
    ? {
        width: Math.min(3840, Math.max(320, Math.round(Number(requestedCanvas.width)))),
        height: Math.min(3840, Math.max(320, Math.round(Number(requestedCanvas.height)))),
        fps: Math.min(120, Math.max(1, Number(requestedCanvas.fps))),
      }
    : { ...CANVAS };
  const requestedLayout = layoutConfig?.layout;
  const regions = Array.isArray(requestedLayout?.regions) && requestedLayout.regions.length > 0
    ? requestedLayout.regions
        .filter((region) => region && typeof region.id === 'string')
        .map((region, index) => {
          const widthPct = Math.min(100, Math.max(5, Number(region.widthPct) || 100));
          const heightPct = Math.min(100, Math.max(5, Number(region.heightPct) || 100));
          return {
            id: region.id,
            name: String(region.name || `Area ${index + 1}`),
            xPct: Math.min(100 - widthPct, Math.max(0, Number(region.xPct) || 0)),
            yPct: Math.min(100 - heightPct, Math.max(0, Number(region.yPct) || 0)),
            widthPct,
            heightPct,
            visible: region.visible !== false,
          };
        })
    : cloneValue(DEFAULT_LAYOUT.regions);

  return {
    canvas,
    layout: {
      ...cloneValue(DEFAULT_LAYOUT),
      ...(requestedLayout || {}),
      regions: regions.length > 0 ? regions : cloneValue(DEFAULT_LAYOUT.regions),
    },
  };
}

function createTrackItem(video, clip, regionId = 'main') {
  const sourceInMs = Math.max(0, Math.round(Number(clip.startSeconds || 0) * 1000));
  const sourceOutMs = Math.max(sourceInMs + 100, Math.round(Number(clip.endSeconds || 1) * 1000));

  return {
    id: crypto.randomUUID(),
    assetId: video.id,
    sourceInMs,
    sourceOutMs,
    timelineStartMs: 0,
    regionId,
    mediaType: 'video',
    transform: {
      x: 0,
      y: 0,
      scale: 1,
      cropMode: 'cover',
      rotation: 0,
    },
  };
}

function getFaceTrackingForClip(video, clip) {
  const tracking = video?.analysis?.tools?.mediapipe?.faceTracking;
  if (!Array.isArray(tracking) || tracking.length === 0) {
    return [];
  }

  const clipStartMs = Math.max(0, Math.round(Number(clip.startSeconds || 0) * 1000));
  const clipEndMs = Math.max(clipStartMs + 100, Math.round(Number(clip.endSeconds || 1) * 1000));
  const durationMs = clipEndMs - clipStartMs;
  const keyframes = tracking
    .map((keyframe) => {
      const sourceTimeMs = Number(keyframe?.timeMs);
      if (!Number.isFinite(sourceTimeMs) || sourceTimeMs < clipStartMs || sourceTimeMs > clipEndMs) {
        return null;
      }

      return {
        timeMs: Math.min(durationMs, Math.max(0, Math.round(sourceTimeMs - clipStartMs))),
        x: Math.min(100, Math.max(-100, Number(keyframe.x) || 0)),
        y: Math.min(100, Math.max(-100, Number(keyframe.y) || 0)),
        scale: Math.min(3, Math.max(0.5, Number(keyframe.scale) || 1)),
        rotation: Math.min(180, Math.max(-180, Number(keyframe.rotation) || 0)),
      };
    })
    .filter(Boolean)
    .sort((first, second) => first.timeMs - second.timeMs);

  if (keyframes.length < 2) {
    return keyframes;
  }

  return keyframes.filter((keyframe, index, values) => index === 0 || keyframe.timeMs !== values[index - 1].timeMs);
}

function createComposition(projectId, video, clip, layoutConfig, index = 0) {
  const now = new Date().toISOString();
  const item = createTrackItem(video, clip, layoutConfig.layout.regions[0]?.id || 'main');
  const framingTrack = getFaceTrackingForClip(video, clip);

  return {
    version: 2,
    id: crypto.randomUUID(),
    projectId,
    clipId: clip.id,
    title: clip.title || `Corte ${String(index + 1).padStart(2, '0')}`,
    analysisRef: {
      transcriptId: video.analysisPath || `video:${video.id}:transcript`,
    },
    canvas: cloneValue(layoutConfig.canvas),
    durationMs: item.sourceOutMs - item.sourceInMs,
    tracks: [
      {
        id: crypto.randomUUID(),
        kind: 'video',
        items: [item],
      },
    ],
    captionSettings: {
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
    },
    ...(framingTrack.length > 0 ? { framingTrack } : {}),
    layout: cloneValue(layoutConfig.layout),
    aiMetadata: {
      engine: 'ClipCut Core',
      model: 'clipcut-drafts-v1',
      reasons: [
        'Corte sugerido a partir do intervalo selecionado.',
        ...(framingTrack.length > 0 ? ['Rastreamento facial aplicado ao reenquadramento.'] : []),
      ],
    },
    status: 'suggested',
    review: {
      status: 'pending',
      issues: [],
    },
    selectedForExport: true,
    revision: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeComposition(composition) {
  if (!composition || typeof composition !== 'object') {
    return composition;
  }

  const rawCaptionSettings = composition.captionSettings || {};
  const captionPosition = ['top', 'middle', 'bottom'].includes(rawCaptionSettings.position)
    ? rawCaptionSettings.position
    : 'bottom';
  const captionPositionDefaults = {
    top: { x: 50, y: 12 },
    middle: { x: 50, y: 50 },
    bottom: { x: 50, y: 86 },
  }[captionPosition];
  const normalizedComposition = {
    ...composition,
    version: 2,
    analysisRef: composition.analysisRef || {
      transcriptId: `composition:${composition.id}:transcript`,
    },
    aiMetadata: {
      ...(composition.aiMetadata || {}),
      engine: composition.aiMetadata?.engine || 'ClipCut Core',
      reasons: Array.isArray(composition.aiMetadata?.reasons) ? composition.aiMetadata.reasons : [],
    },
    captionSettings: {
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
      ...rawCaptionSettings,
      position: captionPosition,
      positionX: Number.isFinite(Number(rawCaptionSettings.positionX)) ? Number(rawCaptionSettings.positionX) : captionPositionDefaults.x,
      positionY: Number.isFinite(Number(rawCaptionSettings.positionY)) ? Number(rawCaptionSettings.positionY) : captionPositionDefaults.y,
    },
  };

  const hasLegacyFramingIssue = normalizedComposition.review?.issues?.some((issue) =>
    String(issue).includes('muito deslocado') || String(issue).includes('faixa recomendada'),
  );

  return hasLegacyFramingIssue
    ? { ...normalizedComposition, review: reviewComposition(normalizedComposition) }
    : normalizedComposition;
}

const SEMANTIC_CONTEXT_OPENERS = new Set([
  'e', 'mas', 'entao', 'tambem', 'isso', 'isto', 'aquilo', 'ele', 'ela', 'eles', 'elas',
  'aqui', 'ali', 'la', 'por isso', 'nesse caso', 'nessa situacao', 'dessa forma', 'como eu disse',
]);
const SEMANTIC_INCOMPLETE_ENDINGS = new Set([
  'a', 'as', 'ao', 'aos', 'com', 'da', 'das', 'de', 'do', 'dos', 'e', 'em', 'essa', 'esse',
  'esta', 'este', 'eu', 'mas', 'na', 'nas', 'nem', 'no', 'nos', 'ou', 'para', 'pelo', 'pela',
  'por', 'que', 'se', 'sem', 'tambem', 'um', 'uma', 'quando', 'porque',
]);
const SEMANTIC_FILLER_WORDS = new Set(['ah', 'aham', 'basicamente', 'tipo', 'hum', 'ne', 'uh']);

function normalizeSemanticText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSemanticSegments(context = {}) {
  const sourceSegments = context.transcriptSegments || context.video?.analysis?.tools?.whisperx?.segments;
  if (!Array.isArray(sourceSegments)) {
    return [];
  }

  return sourceSegments
    .map((segment) => ({
      start: Number(segment?.start),
      end: Number(segment?.end),
      text: String(segment?.text || '').replace(/\s+/g, ' ').trim(),
      words: Array.isArray(segment?.words)
        ? segment.words
            .map((word) => ({
              start: Number(word?.start),
              end: Number(word?.end),
              text: String(word?.word || word?.text || '').trim(),
            }))
            .filter((word) => Number.isFinite(word.start) && Number.isFinite(word.end) && word.end > word.start && word.text)
        : [],
    }))
    .filter((segment) => Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.end > segment.start && segment.text)
    .sort((first, second) => first.start - second.start);
}

function semanticWordsFromText(text) {
  return normalizeSemanticText(text).split(/\s+/).filter(Boolean);
}

function hasSentenceEnding(text) {
  return /[.!?…]["'»)]?$/.test(String(text || '').trim());
}

function semanticLastWord(text) {
  return semanticWordsFromText(text).at(-1) || '';
}

function hasContextDependentOpening(text) {
  const normalizedText = normalizeSemanticText(text);
  return normalizedText.length > 0 && Array.from(SEMANTIC_CONTEXT_OPENERS).some((opening) =>
    normalizedText === opening || normalizedText.startsWith(`${opening} `),
  );
}

function hasLikelyIncompleteEnding(text) {
  const normalizedText = normalizeSemanticText(text);
  return normalizedText.length > 0 && !hasSentenceEnding(text) && SEMANTIC_INCOMPLETE_ENDINGS.has(semanticLastWord(normalizedText));
}

function semanticScore(value) {
  return Math.round(Math.min(100, Math.max(0, Number(value) || 0)));
}

function reviewSemanticCut(composition, context = {}) {
  const videoTrack = composition?.tracks?.find((track) => track.kind === 'video');
  const videoItem = videoTrack?.items?.[0];
  const clipStart = Math.max(0, Number(videoItem?.sourceInMs || 0) / 1000);
  const clipEnd = Math.max(clipStart + 0.1, Number(videoItem?.sourceOutMs || 0) / 1000);
  const durationSeconds = Math.max(clipEnd - clipStart, 0.1);
  const transcriptSegments = normalizeSemanticSegments(context);
  const baseEvidence = {
    transcriptAvailable: transcriptSegments.length > 0,
    transcriptWordCount: transcriptSegments.reduce((total, segment) => total + semanticWordsFromText(segment.text).length, 0),
    clipStartSeconds: Number(clipStart.toFixed(2)),
    clipEndSeconds: Number(clipEnd.toFixed(2)),
  };

  if (transcriptSegments.length === 0) {
    return {
      status: 'insufficient-data',
      score: 0,
      method: 'transcript-boundaries-v1',
      summary: 'A transcricao ainda nao esta disponivel para confirmar se o corte preserva o sentido da fala.',
      dimensions: [],
      issues: ['A analise semantica precisa de uma transcricao valida para confirmar contexto, frase e encerramento.'],
      warnings: [],
      evidence: baseEvidence,
    };
  }

  const activeSegments = transcriptSegments.filter((segment) => segment.end > clipStart && segment.start < clipEnd);
  if (activeSegments.length === 0) {
    return {
      status: 'insufficient-data',
      score: 0,
      method: 'transcript-boundaries-v1',
      summary: 'Nenhuma fala foi encontrada dentro da janela selecionada.',
      dimensions: [],
      issues: ['O corte nao possui fala detectada dentro do intervalo para validar o sentido.'],
      warnings: [],
      evidence: { ...baseEvidence, transcriptAvailable: true },
    };
  }

  const firstSegment = activeSegments[0];
  const lastSegment = activeSegments.at(-1);
  const firstWord = firstSegment.words.find((word) => word.end > clipStart) || null;
  const lastWord = [...lastSegment.words].reverse().find((word) => word.start < clipEnd) || null;
  const startsMidWord = Boolean(firstWord && firstWord.start < clipStart - 0.08 && firstWord.end > clipStart);
  const endsMidWord = Boolean(lastWord && lastWord.start < clipEnd && lastWord.end > clipEnd + 0.08);
  const startsMidSegment = !firstWord && firstSegment.start + 0.65 < clipStart && firstSegment.end > clipStart + 0.1;
  const endsMidSegment = !lastWord && lastSegment.end > clipEnd + 0.65 && lastSegment.start < clipEnd - 0.1;
  const previousSegment = transcriptSegments.filter((segment) => segment.end <= clipStart).at(-1);
  const nextSegment = transcriptSegments.find((segment) => segment.start >= clipEnd);
  const firstText = firstSegment.text;
  const lastText = lastSegment.text;
  const contextDependentOpening = hasContextDependentOpening(firstText);
  const incompleteEnding = hasLikelyIncompleteEnding(lastText);
  const leadingSilence = Math.max(0, firstSegment.start - clipStart);
  const trailingSilence = Math.max(0, clipEnd - lastSegment.end);
  const internalGaps = activeSegments.slice(1).map((segment, index) => Math.max(0, segment.start - activeSegments[index].end));
  const longestInternalGap = Math.max(0, ...internalGaps);
  const speechSeconds = activeSegments.reduce((total, segment) =>
    total + Math.max(0, Math.min(segment.end, clipEnd) - Math.max(segment.start, clipStart)),
  0);
  const speechCoverage = Math.min(1, speechSeconds / durationSeconds);
  const transcriptWordCount = activeSegments.reduce((total, segment) => total + semanticWordsFromText(segment.text).length, 0);
  const wordsPerSecond = transcriptWordCount / durationSeconds;
  const normalizedTranscript = normalizeSemanticText(activeSegments.map((segment) => segment.text).join(' '));
  const fillerCount = semanticWordsFromText(normalizedTranscript).filter((word) => SEMANTIC_FILLER_WORDS.has(word)).length;
  const fillerRate = fillerCount / Math.max(transcriptWordCount, 1);
  const issues = [];
  const warnings = [];

  if (startsMidWord || startsMidSegment) {
    issues.push('O corte comeca no meio de uma fala; a frase pode ter sido interrompida na abertura.');
  }
  if (contextDependentOpening || (previousSegment && !hasSentenceEnding(previousSegment.text) && firstSegment.start < clipStart + 0.8)) {
    issues.push('A abertura usa uma referencia que pode depender do contexto da fala anterior.');
  }
  if (endsMidWord || endsMidSegment) {
    issues.push('O corte termina no meio de uma fala; a frase pode ter sido cortada antes de concluir.');
  }
  if (incompleteEnding) {
    issues.push('O final termina em uma palavra de ligacao; a ideia pode continuar fora do corte.');
  }
  if (speechCoverage < 0.18) {
    issues.push('Ha pouca fala dentro do intervalo para confirmar uma ideia completa.');
  }
  if (leadingSilence > 2.5) {
    warnings.push(`O corte comeca com ${leadingSilence.toFixed(1)}s de silencio antes da fala.`);
  }
  if (trailingSilence > 2.5) {
    warnings.push(`O corte termina com ${trailingSilence.toFixed(1)}s de silencio depois da fala.`);
  }
  if (longestInternalGap > 2.5) {
    warnings.push(`Existe uma pausa interna de ${longestInternalGap.toFixed(1)}s que pode quebrar o ritmo.`);
  }
  if (!hasSentenceEnding(lastText) && !incompleteEnding) {
    warnings.push('O final nao possui pontuacao conclusiva na transcricao; confira se a ideia terminou naturalmente.');
  }
  if (fillerRate > 0.12) {
    warnings.push('O trecho possui concentracao elevada de palavras de preenchimento.');
  }
  if (wordsPerSecond < 0.7 || wordsPerSecond > 5.5) {
    warnings.push(`O ritmo estimado e de ${wordsPerSecond.toFixed(1)} palavras por segundo.`);
  }

  const openingScore = semanticScore(100 - (startsMidWord ? 48 : startsMidSegment ? 28 : 0) - (contextDependentOpening ? 28 : 0) - Math.min(22, leadingSilence * 7));
  const contextScore = semanticScore(100 - (contextDependentOpening ? 42 : 0) - (previousSegment && !hasSentenceEnding(previousSegment.text) ? 18 : 0) - (speechCoverage < 0.35 ? 20 : 0));
  const completenessScore = semanticScore(100 - (startsMidWord ? 35 : startsMidSegment ? 18 : 0) - (endsMidWord ? 45 : endsMidSegment ? 25 : 0) - (incompleteEnding ? 35 : 0));
  const endingScore = semanticScore(100 - (endsMidWord ? 50 : endsMidSegment ? 28 : 0) - (incompleteEnding ? 35 : 0) - (trailingSilence > 2.5 ? 15 : 0));
  const flowScore = semanticScore(speechCoverage * 100 - Math.min(25, longestInternalGap * 6) - Math.min(20, fillerRate * 100));
  const dimensions = [
    {
      id: 'opening',
      label: 'Abertura',
      score: openingScore,
      evidence: startsMidWord || startsMidSegment ? 'A janela inicia durante uma fala.' : contextDependentOpening ? 'A abertura pode depender de uma referencia anterior.' : leadingSilence > 2.5 ? 'A fala demora a entrar no corte.' : 'A janela inicia em um limite de fala plausivel.',
    },
    {
      id: 'context',
      label: 'Contexto',
      score: contextScore,
      evidence: contextDependentOpening || (previousSegment && !hasSentenceEnding(previousSegment.text)) ? 'Foi detectada dependencia possivel da fala anterior.' : 'Nao foi detectada dependencia forte de contexto anterior.',
    },
    {
      id: 'completeness',
      label: 'Frase completa',
      score: completenessScore,
      evidence: endsMidWord || endsMidSegment || incompleteEnding ? 'O final pode interromper a construcao da frase.' : 'A fala possui limites suficientes para preservar a frase.',
    },
    {
      id: 'ending',
      label: 'Encerramento',
      score: endingScore,
      evidence: hasSentenceEnding(lastText) ? 'A transcricao indica encerramento de frase.' : trailingSilence > 2.5 ? 'Ha silencio depois da fala antes do fim da janela.' : 'O encerramento precisa de confirmacao pelo contexto da fala.',
    },
    {
      id: 'flow',
      label: 'Ritmo da fala',
      score: flowScore,
      evidence: `${transcriptWordCount} palavras em ${durationSeconds.toFixed(1)}s, com ${Math.round(speechCoverage * 100)}% de cobertura falada.`,
    },
  ];
  const weights = { opening: 0.22, context: 0.2, completeness: 0.25, ending: 0.23, flow: 0.1 };
  const score = semanticScore(dimensions.reduce((total, dimension) => total + dimension.score * (weights[dimension.id] || 0), 0));
  const status = issues.length > 0 ? 'needs-adjustment' : 'ready';

  return {
    status,
    score,
    method: 'transcript-boundaries-v1',
    summary: status === 'ready'
      ? 'A janela preserva limites de fala plausiveis e nao apresentou quebra semantica forte.'
      : 'A janela apresentou sinais de quebra de frase, contexto ou encerramento que precisam ser revisados.',
    dimensions,
    issues,
    warnings,
    evidence: {
      ...baseEvidence,
      transcriptAvailable: true,
      transcriptWordCount,
      speechCoverage: Number(speechCoverage.toFixed(3)),
      leadingSilence: Number(leadingSilence.toFixed(2)),
      trailingSilence: Number(trailingSilence.toFixed(2)),
      longestInternalGap: Number(longestInternalGap.toFixed(2)),
      wordsPerSecond: Number(wordsPerSecond.toFixed(2)),
      fillerRate: Number(fillerRate.toFixed(3)),
      nextSegmentAvailable: Boolean(nextSegment),
      startsMidWord,
      endsMidWord,
    },
  };
}

function reviewComposition(composition, context = {}) {
  const issues = [];
  const videoTrack = composition?.tracks?.find((track) => track.kind === 'video');
  const items = videoTrack?.items || [];
  const regions = composition?.layout?.regions || [];

  if (items.length === 0) {
    issues.push('Nenhum trecho de vídeo foi encontrado nesta composição.');
  }

  for (const item of items) {
    if (item.mediaType !== 'image' && !hasMinimumDuration(Number(item.sourceInMs) / 1000, Number(item.sourceOutMs) / 1000)) {
      issues.push(`${item.id}: o corte precisa ter pelo menos ${MIN_CLIP_DURATION_SECONDS} segundos.`);
    }

    const transform = item.transform || {};
    const region = regions.find((currentRegion) => currentRegion.id === item.regionId);

    if (!region || region.visible === false) {
      issues.push(`${item.id}: defina uma área visível para o vídeo.`);
    } else if (
      region.xPct < 0 ||
      region.yPct < 0 ||
      region.xPct + region.widthPct > 100 ||
      region.yPct + region.heightPct > 100
    ) {
      issues.push(`${item.id}: a área do vídeo ultrapassa o canvas.`);
    }

    const positionX = Number(transform.x);
    const positionY = Number(transform.y);
    const scale = Number(transform.scale);
    const rotation = Number(transform.rotation || 0);

    if (![positionX, positionY, scale, rotation].every(Number.isFinite)) {
      issues.push(`${item.id}: o enquadramento possui valores inválidos.`);
    } else {
      if (positionX < -100 || positionX > 100) {
        issues.push(`${item.id}: a posição X está fora dos limites do Editor.`);
      }

      if (positionY < -100 || positionY > 100) {
        issues.push(`${item.id}: a posição Y está fora dos limites do Editor.`);
      }

      if (scale < 0.5 || scale > 3) {
        issues.push(`${item.id}: o zoom está fora dos limites do Editor.`);
      }

      if (rotation < -180 || rotation > 180) {
        issues.push(`${item.id}: a rotação está fora dos limites do Editor.`);
      }
    }
  }

  const captionSettings = composition?.captionSettings;
  if (captionSettings?.mode === 'manual' && !String(captionSettings.manualText || '').trim()) {
    issues.push('A legenda manual está selecionada, mas ainda não possui texto.');
  }

  const semantic = reviewSemanticCut(composition, context);
  if (semantic.status === 'needs-adjustment') {
    issues.push(...semantic.issues.map((issue) => `Semantica: ${issue}`));
  }

  return {
    status: issues.length > 0 ? 'needs-adjustment' : 'ready',
    issues,
    semantic,
    checkedAt: new Date().toISOString(),
  };
}

function hasMinimumClipDuration(composition) {
  const videoItems = (composition?.tracks || [])
    .filter((track) => track.kind === 'video')
    .flatMap((track) => track.items || []);

  return videoItems.length > 0 && videoItems.every((item) =>
    hasMinimumDuration(Number(item.sourceInMs) / 1000, Number(item.sourceOutMs) / 1000),
  );
}

function createProject(video, clips, requestedLayoutConfig = null) {
  const projectId = crypto.randomUUID();
  const layoutConfig = normalizeLayoutConfig(requestedLayoutConfig);
  const selectedClips = clips.length > 0 ? clips : [
    {
      id: crypto.randomUUID(),
      title: 'Rascunho 01',
      startSeconds: 0,
      endSeconds: Math.max(Number(video.durationSeconds || 1), 1),
    },
  ];
  const now = new Date().toISOString();

  return {
    version: 1,
    id: projectId,
    title: `Projeto - ${video.originalName}`,
    sourceVideoId: video.id,
    sourceName: video.originalName,
    assets: [
      {
        id: video.id,
        type: 'video',
        name: video.originalName,
        url: video.url,
        durationSeconds: video.durationSeconds,
      },
    ],
    compositions: selectedClips.map((clip, index) => createComposition(projectId, video, clip, layoutConfig, index)),
    layoutTemplate: cloneValue(layoutConfig),
    createdAt: now,
    updatedAt: now,
  };
}

function isValidComposition(composition) {
  if (!composition || ![1, 2].includes(composition.version)) {
    return false;
  }

  if (
    typeof composition.id !== 'string' ||
    typeof composition.projectId !== 'string' ||
    typeof composition.clipId !== 'string' ||
    typeof composition.durationMs !== 'number' ||
    composition.durationMs < 0 ||
    typeof composition.revision !== 'number' ||
    !Array.isArray(composition.tracks) ||
    !composition.layout ||
    !Array.isArray(composition.layout.regions)
  ) {
    return false;
  }

  if (
    !composition.canvas ||
    !Number.isFinite(composition.canvas.width) ||
    !Number.isFinite(composition.canvas.height) ||
    !Number.isFinite(composition.canvas.fps) ||
    composition.canvas.width < 320 ||
    composition.canvas.width > 3840 ||
    composition.canvas.height < 320 ||
    composition.canvas.height > 3840 ||
    composition.canvas.fps <= 0
  ) {
    return false;
  }

  const validPresets = ['vertical', 'portrait', 'square', 'landscape', 'classic', 'custom'];
  if (composition.layout.preset && !validPresets.includes(composition.layout.preset)) {
    return false;
  }

  if (!composition.layout.regions.every((region) =>
    region &&
    typeof region.id === 'string' &&
    typeof region.name === 'string' &&
    Number.isFinite(region.xPct) &&
    Number.isFinite(region.yPct) &&
    Number.isFinite(region.widthPct) &&
    Number.isFinite(region.heightPct) &&
    region.xPct >= 0 &&
    region.yPct >= 0 &&
    region.widthPct > 0 &&
    region.heightPct > 0 &&
    region.xPct + region.widthPct <= 100 &&
    region.yPct + region.heightPct <= 100 &&
    typeof region.visible === 'boolean',
  )) {
    return false;
  }

  return composition.tracks.every((track) =>
    track &&
    typeof track.id === 'string' &&
    ['video', 'audio', 'caption', 'media'].includes(track.kind) &&
    Array.isArray(track.items) &&
    track.items.every((item) =>
      item &&
      typeof item.id === 'string' &&
      typeof item.assetId === 'string' &&
      typeof item.regionId === 'string' &&
      Number.isFinite(item.sourceInMs) &&
      Number.isFinite(item.sourceOutMs) &&
      item.sourceOutMs > item.sourceInMs &&
      Number.isFinite(item.timelineStartMs) &&
      item.transform &&
      Number.isFinite(item.transform.x) &&
      item.transform.x >= -100 &&
      item.transform.x <= 100 &&
      Number.isFinite(item.transform.y) &&
      item.transform.y >= -100 &&
      item.transform.y <= 100 &&
      Number.isFinite(item.transform.scale) &&
      item.transform.scale >= (item.mediaType === 'image' ? 0.1 : 0.5) &&
      item.transform.scale <= 3 &&
      ['cover', 'contain', 'custom'].includes(item.transform.cropMode) &&
      (item.mediaType === undefined || ['video', 'image'].includes(item.mediaType)) &&
      (item.transform.rotation === undefined || Number.isFinite(item.transform.rotation)),
    ),
  );
}

module.exports = {
  CANVAS,
  MIN_CLIP_DURATION_MS,
  createProject,
  hasMinimumClipDuration,
  isValidComposition,
  normalizeComposition,
  normalizeLayoutConfig,
  reviewComposition,
};
