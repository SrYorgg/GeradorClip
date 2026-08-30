const crypto = require('crypto');
const { MIN_CLIP_DURATION_MS, hasMinimumDuration } = require('./video-rules.cjs');

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

function createComposition(projectId, video, clip, layoutConfig, index = 0) {
  const now = new Date().toISOString();
  const item = createTrackItem(video, clip, layoutConfig.layout.regions[0]?.id || 'main');

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
      font: 'inter',
      position: 'bottom',
      displayMode: 'block',
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
    layout: cloneValue(layoutConfig.layout),
    aiMetadata: {
      engine: 'ClipCut Core',
      model: 'clipcut-drafts-v1',
      reasons: ['Corte sugerido a partir do intervalo selecionado.'],
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
      font: 'inter',
      position: 'bottom',
      displayMode: 'block',
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

function reviewComposition(composition) {
  const issues = [];
  const videoTrack = composition?.tracks?.find((track) => track.kind === 'video');
  const items = videoTrack?.items || [];
  const regions = composition?.layout?.regions || [];

  if (items.length === 0) {
    issues.push('Nenhum trecho de vídeo foi encontrado nesta composição.');
  }

  for (const item of items) {
    if (item.mediaType !== 'image' && !hasMinimumDuration(Number(item.sourceInMs) / 1000, Number(item.sourceOutMs) / 1000)) {
      issues.push(`${item.id}: cada corte precisa ter pelo menos 1 minuto.`);
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

  return {
    status: issues.length > 0 ? 'needs-adjustment' : 'ready',
    issues,
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
