const crypto = require('crypto');

const CANVAS = { width: 1080, height: 1920, fps: 30 };

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
    transform: {
      x: 0,
      y: 0,
      scale: 1,
      cropMode: 'cover',
      rotation: 0,
    },
  };
}

function createComposition(projectId, video, clip, index = 0) {
  const now = new Date().toISOString();
  const item = createTrackItem(video, clip);

  return {
    version: 1,
    id: crypto.randomUUID(),
    projectId,
    clipId: clip.id,
    title: clip.title || `Corte ${String(index + 1).padStart(2, '0')}`,
    canvas: CANVAS,
    durationMs: item.sourceOutMs - item.sourceInMs,
    tracks: [
      {
        id: crypto.randomUUID(),
        kind: 'video',
        items: [item],
      },
    ],
    layout: {
      id: 'vertical-main',
      name: 'Vertical 9:16',
      preset: 'vertical',
      background: '#05050a',
      showSafeArea: true,
      regions: [
        {
          id: 'main',
          name: 'Vídeo principal',
          xPct: 0,
          yPct: 0,
          widthPct: 100,
          heightPct: 100,
          visible: true,
        },
      ],
    },
    aiMetadata: {
      model: 'geradorclip-drafts-v1',
      reasons: ['Corte sugerido a partir do intervalo selecionado.'],
    },
    status: 'suggested',
    revision: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function createProject(video, clips) {
  const projectId = crypto.randomUUID();
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
    compositions: selectedClips.map((clip, index) => createComposition(projectId, video, clip, index)),
    createdAt: now,
    updatedAt: now,
  };
}

function isValidComposition(composition) {
  if (!composition || composition.version !== 1) {
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
    track && typeof track.id === 'string' && Array.isArray(track.items) && track.items.every((item) =>
      item &&
      typeof item.id === 'string' &&
      typeof item.assetId === 'string' &&
      Number.isFinite(item.sourceInMs) &&
      Number.isFinite(item.sourceOutMs) &&
      item.sourceOutMs > item.sourceInMs &&
      Number.isFinite(item.timelineStartMs) &&
      item.transform &&
      Number.isFinite(item.transform.x) &&
      Number.isFinite(item.transform.y) &&
      Number.isFinite(item.transform.scale) &&
      item.transform.scale > 0 &&
      ['cover', 'contain', 'custom'].includes(item.transform.cropMode) &&
      (item.transform.rotation === undefined || Number.isFinite(item.transform.rotation)),
    ),
  );
}

module.exports = {
  CANVAS,
  createProject,
  isValidComposition,
};
