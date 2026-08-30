const cors = require('cors');
const crypto = require('crypto');
const { spawn } = require('child_process');
const express = require('express');
const fs = require('fs');
const multer = require('multer');
const os = require('os');
const path = require('path');
const {
  createProject,
  hasMinimumClipDuration,
  isValidComposition,
  normalizeComposition,
  reviewComposition,
} = require('./composition.cjs');
const { createEditorialService } = require('./editorial.cjs');
const { buildSuggestedClips } = require('./clip-rules.cjs');
const {
  MAX_VIDEO_DURATION_SECONDS,
  MIN_CLIP_DURATION_SECONDS,
  getMaxClipCount,
  hasMinimumDuration,
} = require('./video-rules.cjs');

const ROOT_DIR = path.resolve(__dirname, '..');

function loadLocalEnv(envPath) {
  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmedLine.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmedLine.slice(0, separatorIndex).trim();
    let value = trimmedLine.slice(separatorIndex + 1).trim();

    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) {
      continue;
    }

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

loadLocalEnv(path.join(ROOT_DIR, '.env'));

const PORT = Number(process.env.API_PORT || 3333);
const VIDEOS_DIR = path.join(ROOT_DIR, 'public', 'videos');
const GALLERY_DIR = path.join(ROOT_DIR, 'public', 'gallery');
const PROJECT_ASSETS_DIR = path.join(ROOT_DIR, 'public', 'project-assets');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const PROJECTS_DIR = path.join(DATA_DIR, 'projects');
const MANIFEST_PATH = path.join(VIDEOS_DIR, 'manifest.json');
const GALLERY_MANIFEST_PATH = path.join(GALLERY_DIR, 'manifest.json');
const EXPORT_JOBS_PATH = path.join(DATA_DIR, 'export-jobs.json');
const EXPORT_JOB_CONCURRENCY = Math.min(8, Math.max(1, Number(process.env.EXPORT_JOB_CONCURRENCY || 2)));
const AI_DIR = path.join(ROOT_DIR, 'ai');
const DEFAULT_PYTHON_BIN = path.join(ROOT_DIR, '.venv', 'Scripts', 'python.exe');
const configuredPythonBin = process.env.PYTHON_BIN;
const PYTHON_BIN = configuredPythonBin
  ? (path.isAbsolute(configuredPythonBin) ? configuredPythonBin : path.resolve(ROOT_DIR, configuredPythonBin))
  : (fs.existsSync(DEFAULT_PYTHON_BIN) ? DEFAULT_PYTHON_BIN : 'python');
const MATPLOTLIB_CACHE_DIR = path.join(ROOT_DIR, '.cache', 'matplotlib');

fs.mkdirSync(VIDEOS_DIR, { recursive: true });
fs.mkdirSync(GALLERY_DIR, { recursive: true });
fs.mkdirSync(PROJECT_ASSETS_DIR, { recursive: true });
fs.mkdirSync(PROJECTS_DIR, { recursive: true });
fs.mkdirSync(MATPLOTLIB_CACHE_DIR, { recursive: true });

const editorialService = createEditorialService({ dataDir: DATA_DIR });

function readJsonFile(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function cloneJson(data) {
  return JSON.parse(JSON.stringify(data));
}

function readJsonArray(filePath) {
  const data = readJsonFile(filePath, []);

  if (Array.isArray(data)) {
    return data;
  }

  return data && typeof data === 'object' ? [data] : [];
}

function readManifest() {
  return readJsonArray(MANIFEST_PATH);
}

function writeManifest(videos) {
  writeJsonFile(MANIFEST_PATH, videos);
}

function readGalleryManifest() {
  return readJsonArray(GALLERY_MANIFEST_PATH);
}

function writeGalleryManifest(packages) {
  writeJsonFile(GALLERY_MANIFEST_PATH, packages);
}

function writeJsonFileAtomic(filePath, data) {
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(data, null, 2));
  fs.renameSync(temporaryPath, filePath);
}

function readExportJobs() {
  return readJsonArray(EXPORT_JOBS_PATH);
}

function writeExportJobs(jobs) {
  writeJsonFileAtomic(EXPORT_JOBS_PATH, jobs);
}

function getExportJob(jobId) {
  return readExportJobs().find((job) => job.id === jobId) || null;
}

function updateExportJob(jobId, updater) {
  const jobs = readExportJobs();
  const jobIndex = jobs.findIndex((job) => job.id === jobId);
  if (jobIndex === -1) {
    return null;
  }

  const updatedJob = updater(cloneJson(jobs[jobIndex]));
  if (!updatedJob) {
    return null;
  }

  jobs[jobIndex] = updatedJob;
  writeExportJobs(jobs);
  return updatedJob;
}

function publicExportJob(job) {
  const { clipSnapshots, compositionSnapshots, ...safeJob } = job;
  return {
    ...safeJob,
    clipResults: (job.clipResults || []).map(({ outputPath, ...clipResult }) => clipResult),
  };
}

function getVideoById(id) {
  const videos = readManifest();
  const video = videos.find((item) => item.id === id);
  return { videos, video };
}

function getSafeVideoPath(fileName) {
  const videoRoot = path.resolve(VIDEOS_DIR);
  const resolvedVideoPath = path.resolve(videoRoot, String(fileName || ''));

  if (resolvedVideoPath !== videoRoot && !resolvedVideoPath.startsWith(`${videoRoot}${path.sep}`)) {
    throw new Error('INVALID_VIDEO_PATH');
  }

  return resolvedVideoPath;
}

function getSafeProjectAssetPath(fileName) {
  const assetPath = path.join(PROJECT_ASSETS_DIR, String(fileName || ''));
  const resolvedAssetPath = path.resolve(assetPath);
  const assetRoot = path.resolve(PROJECT_ASSETS_DIR) + path.sep;

  if (!resolvedAssetPath.startsWith(assetRoot)) {
    throw new Error('INVALID_PROJECT_ASSET_PATH');
  }

  return resolvedAssetPath;
}

function getSafeGalleryPath(folderName) {
  const galleryRoot = path.resolve(GALLERY_DIR);
  const resolvedGalleryPath = path.resolve(galleryRoot, String(folderName || ''));

  if (resolvedGalleryPath !== galleryRoot && !resolvedGalleryPath.startsWith(`${galleryRoot}${path.sep}`)) {
    throw new Error('INVALID_GALLERY_PATH');
  }

  return resolvedGalleryPath;
}

function updateVideo(id, updater) {
  const videos = readManifest();
  const videoIndex = videos.findIndex((item) => item.id === id);

  if (videoIndex === -1) {
    return null;
  }

  videos[videoIndex] = updater(videos[videoIndex]);
  writeManifest(videos);
  return videos[videoIndex];
}

function getSafeProjectPath(projectId) {
  if (!/^[a-zA-Z0-9-]+$/.test(String(projectId || ''))) {
    throw new Error('INVALID_PROJECT_ID');
  }

  const projectPath = path.resolve(PROJECTS_DIR, `${projectId}.json`);
  if (!projectPath.startsWith(path.resolve(PROJECTS_DIR) + path.sep)) {
    throw new Error('INVALID_PROJECT_PATH');
  }

  return projectPath;
}

function readProject(projectId) {
  try {
    const project = readJsonFile(getSafeProjectPath(projectId), null);
    return project
      ? {
          ...project,
          compositions: (project.compositions || []).map(normalizeComposition),
        }
      : null;
  } catch {
    return null;
  }
}

function writeProject(project) {
  writeJsonFile(getSafeProjectPath(project.id), project);
}

function listProjects() {
  return fs
    .readdirSync(PROJECTS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => {
      const project = readJsonFile(path.join(PROJECTS_DIR, entry.name), null);
      return project
        ? {
            ...project,
            compositions: (project.compositions || []).map(normalizeComposition),
          }
        : null;
    })
    .filter(Boolean)
    .sort((first, second) => String(second.updatedAt || '').localeCompare(String(first.updatedAt || '')));
}

function findComposition(compositionId) {
  for (const project of listProjects()) {
    const composition = project.compositions?.find((item) => item.id === compositionId);
    if (composition) {
      return { project, composition };
    }
  }

  return { project: null, composition: null };
}

function getProjectSummary(project) {
  const statuses = (project.compositions || []).reduce(
    (result, composition) => ({
      ...result,
      [composition.status]: (result[composition.status] || 0) + 1,
    }),
    {
      suggested: 0,
      editing: 0,
      approved: 0,
      exporting: 0,
      completed: 0,
      error: 0,
    },
  );

  return {
    id: project.id,
    title: project.title,
    sourceVideoId: project.sourceVideoId,
    sourceName: project.sourceName,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    compositionCount: project.compositions?.length || 0,
    firstCompositionId: project.compositions?.[0]?.id,
    isLayoutDraft: project.isLayoutDraft === true,
    statuses,
  };
}

function sanitizeFileName(fileName) {
  return fileName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function findExecutable(name, envName) {
  if (process.env[envName]) {
    const configuredPath = path.isAbsolute(process.env[envName])
      ? process.env[envName]
      : path.resolve(ROOT_DIR, process.env[envName]);
    if (fs.existsSync(configuredPath)) {
      return configuredPath;
    }
  }

  const pathEntries = (process.env.PATH || '').split(path.delimiter);
  for (const pathEntry of pathEntries) {
    const candidate = path.join(pathEntry, process.platform === 'win32' ? `${name}.exe` : name);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  if (process.platform !== 'win32') {
    return name;
  }

  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) {
    return null;
  }

  const directCandidates = [
    path.join(localAppData, 'Microsoft', 'WinGet', 'Links', `${name}.exe`),
    path.join(localAppData, 'Programs', 'Ollama', `${name}.exe`),
  ];

  for (const candidate of directCandidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  const wingetPackages = path.join(localAppData, 'Microsoft', 'WinGet', 'Packages');
  if (!fs.existsSync(wingetPackages)) {
    return null;
  }

  const stack = [wingetPackages];
  while (stack.length > 0) {
    const currentPath = stack.pop();
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.name.toLowerCase() === `${name}.exe`) {
        return entryPath;
      }
    }
  }

  return null;
}

const SUBTITLE_FONTS = {
  inter: 'Inter',
  montserrat: 'Montserrat',
  poppins: 'Poppins',
  roboto: 'Roboto',
  'open-sans': 'Open Sans',
  lato: 'Lato',
  oswald: 'Oswald',
};

const SUBTITLE_ALIGNMENTS = {
  bottom: 2,
  middle: 5,
  top: 8,
};

const SUBTITLE_FONT_SIZE = 42;

function getSubtitleFontName(fontId) {
  return SUBTITLE_FONTS[fontId] || SUBTITLE_FONTS.inter;
}

function getSubtitleAlignment(position) {
  return SUBTITLE_ALIGNMENTS[position] || SUBTITLE_ALIGNMENTS.bottom;
}

function chunkSubtitleText(text, maxCharacters = 72) {
  const words = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  const chunks = [];
  let currentChunk = '';

  for (const word of words) {
    const nextChunk = currentChunk ? `${currentChunk} ${word}` : word;
    if (nextChunk.length > maxCharacters && currentChunk) {
      chunks.push(currentChunk);
      currentChunk = word;
    } else {
      currentChunk = nextChunk;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}

function splitSubtitleEntries(entries, maxCharacters = 36) {
  return entries.flatMap((entry) => {
    const chunks = chunkSubtitleText(entry.text, maxCharacters);
    if (chunks.length <= 1) return [entry];

    const start = Number(entry.start) || 0;
    const end = Number(entry.end) || start;
    const duration = Math.max(end - start, 0.1);
    const chunkDuration = duration / chunks.length;

    return chunks.map((text, index) => ({
      start: start + (index * chunkDuration),
      end: index === chunks.length - 1 ? end : start + ((index + 1) * chunkDuration),
      text,
    }));
  });
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseSubtitleCorrections(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separatorIndex = line.indexOf('=');
      if (separatorIndex === -1) {
        return null;
      }

      const from = line.slice(0, separatorIndex).trim();
      const to = line.slice(separatorIndex + 1).trim();
      return from && to ? { from, to } : null;
    })
    .filter(Boolean);
}

function applySubtitleCorrectionsToText(text, corrections) {
  return corrections.reduce((currentText, correction) => {
    return currentText.replace(new RegExp(escapeRegExp(correction.from), 'gi'), correction.to);
  }, text);
}

function applySubtitleCorrections(entries, corrections) {
  if (!Array.isArray(corrections) || corrections.length === 0) {
    return entries;
  }

  return entries.map((entry) => ({
    ...entry,
    text: applySubtitleCorrectionsToText(entry.text, corrections),
  }));
}

function normalizeTranscriptWords(words, segmentStart, segmentEnd) {
  if (!Array.isArray(words)) {
    return [];
  }

  return words
    .map((word) => ({
      start: Number(word.start),
      end: Number(word.end),
      text: String(word.word || word.text || '').trim(),
      confidence: Number.isFinite(Number(word.probability))
        ? Number(word.probability)
        : Number.isFinite(Number(word.score))
          ? Number(word.score)
          : undefined,
    }))
    .filter((word) =>
      Number.isFinite(word.start) &&
      Number.isFinite(word.end) &&
      word.end > word.start &&
      word.text &&
      word.start < segmentEnd &&
      word.end > segmentStart,
    );
}

function buildFallbackTranscriptWords(text, start, end) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (words.length === 0) {
    return [];
  }

  const duration = Math.max(Number(end) - Number(start), 0.1);
  const wordDuration = duration / words.length;
  return words.map((word, index) => ({
    start: Number(start) + (index * wordDuration),
    end: index === words.length - 1 ? Number(end) : Number(start) + ((index + 1) * wordDuration),
    text: word,
  }));
}

function normalizeTranscriptSegments(segments) {
  if (!Array.isArray(segments)) {
    return [];
  }

  return segments
    .map((segment) => {
      const start = Number(segment.start);
      const end = Number(segment.end);
      return {
        start,
        end,
        text: String(segment.text || '').trim(),
        words: normalizeTranscriptWords(segment.words, start, end),
      };
    })
    .filter((segment) => Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.end > segment.start && segment.text);
}

function getSavedTranscriptSegments(video) {
  return normalizeTranscriptSegments(video.analysis?.tools?.whisperx?.segments);
}

function getClipSubtitleEntriesFromSegments(segments, clip) {
  return normalizeTranscriptSegments(segments)
    .filter((segment) => segment.end > clip.startSeconds && segment.start < clip.endSeconds)
    .map((segment) => {
      const start = Math.max(segment.start, clip.startSeconds) - clip.startSeconds;
      const end = Math.min(segment.end, clip.endSeconds) - clip.startSeconds;
      return {
        start,
        end: Math.max(end, start + 0.5),
        text: segment.text,
      };
    });
}

function getAutomaticSubtitleEntries(video, clip) {
  return getClipSubtitleEntriesFromSegments(getSavedTranscriptSegments(video), clip);
}

function getClipSubtitleWordEntriesFromSegments(segments, clip) {
  return normalizeTranscriptSegments(segments)
    .filter((segment) => segment.end > clip.startSeconds && segment.start < clip.endSeconds)
    .flatMap((segment) => {
      const words = segment.words.length > 0
        ? segment.words
        : buildFallbackTranscriptWords(segment.text, segment.start, segment.end);

      return words
        .filter((word) => word.end > clip.startSeconds && word.start < clip.endSeconds)
        .map((word) => ({
          start: Math.max(word.start, clip.startSeconds) - clip.startSeconds,
          end: Math.min(word.end, clip.endSeconds) - clip.startSeconds,
          text: word.text,
          confidence: word.confidence,
        }));
    })
    .filter((word) => word.end > word.start);
}

function getManualSubtitleEntries(clip, manualSubtitleText) {
  const chunks = chunkSubtitleText(manualSubtitleText, 36);
  const duration = Math.max(Number(clip.durationSeconds || 1), 1);
  const slotDuration = duration / Math.max(chunks.length, 1);

  return chunks.map((chunk, index) => {
    const start = Math.max(index * slotDuration, 0);
    const end = Math.min(duration, Math.max(start + 0.8, (index + 1) * slotDuration));

    return {
      start,
      end,
      text: chunk,
    };
  });
}

function getManualSubtitleWordEntries(clip, manualSubtitleText) {
  return getManualSubtitleEntries(clip, manualSubtitleText).flatMap((entry) =>
    buildFallbackTranscriptWords(entry.text, entry.start, entry.end),
  );
}

function normalizeCaptionSettings(settings = {}) {
  settings = settings || {};
  const position = ['top', 'middle', 'bottom'].includes(settings.position) ? settings.position : 'bottom';
  const positionDefaults = {
    top: { x: 50, y: 12 },
    middle: { x: 50, y: 50 },
    bottom: { x: 50, y: 86 },
  }[position];
  const getNumber = (value, fallback, minimum, maximum) => {
    const numericValue = Number(value);
    return Number.isFinite(numericValue)
      ? Math.min(maximum, Math.max(minimum, numericValue))
      : fallback;
  };
  const getColor = (value, fallback) => /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : fallback;

  return {
    mode: ['none', 'automatic', 'manual'].includes(settings.mode) ? settings.mode : 'automatic',
    manualText: String(settings.manualText || ''),
    corrections: String(settings.corrections || ''),
    font: String(settings.font || 'inter'),
    position,
    displayMode: ['block', 'word'].includes(settings.displayMode) ? settings.displayMode : 'block',
    language: ['original', 'pt-BR'].includes(settings.language) ? settings.language : 'pt-BR',
    positionX: getNumber(settings.positionX, positionDefaults.x, 5, 95),
    positionY: getNumber(settings.positionY, positionDefaults.y, 5, 95),
    maxWidthPct: getNumber(settings.maxWidthPct, 84, 25, 95),
    fontSize: getNumber(settings.fontSize, 42, 18, 120),
    textColor: getColor(settings.textColor, '#FFFFFF'),
    highlightColor: getColor(settings.highlightColor, '#73DDBD'),
    outlineColor: getColor(settings.outlineColor, '#111111'),
    outlineWidth: getNumber(settings.outlineWidth, 2, 0, 12),
    backgroundColor: getColor(settings.backgroundColor, '#000000'),
    backgroundOpacity: getNumber(settings.backgroundOpacity, 0.6, 0, 1),
  };
}

function getCaptionContentFingerprint(settings) {
  const normalizedSettings = normalizeCaptionSettings(settings);
  return JSON.stringify({
    mode: normalizedSettings.mode,
    manualText: normalizedSettings.manualText,
    corrections: normalizedSettings.corrections,
    language: normalizedSettings.language,
  });
}

function getCaptionPlacement(settings = {}) {
  const normalizedSettings = normalizeCaptionSettings(settings);
  const normalizedPosition = normalizedSettings.position;
  const values = {
    top: 'top',
    middle: 'center',
    bottom: 'bottom',
  };

  return {
    anchor: values[normalizedPosition],
    xPct: normalizedSettings.positionX,
    yPct: normalizedSettings.positionY,
    maxWidthPct: normalizedSettings.maxWidthPct,
    safeArea: true,
  };
}

function buildCaptionTrack(entries, wordEntries, settings, language) {
  const normalizedWordEntries = Array.isArray(wordEntries) ? wordEntries : [];

  return {
    id: crypto.randomUUID(),
    cues: entries.map((entry, index) => ({
      id: `${entry.id || 'cue'}-${index}-${crypto.randomUUID()}`,
      text: String(entry.text || '').trim(),
      startMs: Math.max(0, Math.round(Number(entry.start || 0) * 1000)),
      endMs: Math.max(0, Math.round(Number(entry.end || 0) * 1000)),
    })).filter((entry) => entry.text && entry.endMs > entry.startMs),
    words: normalizedWordEntries.map((entry, index) => ({
      id: `${entry.id || 'word'}-${index}-${crypto.randomUUID()}`,
      text: String(entry.text || '').trim(),
      startMs: Math.max(0, Math.round(Number(entry.start || 0) * 1000)),
      endMs: Math.max(0, Math.round(Number(entry.end || 0) * 1000)),
      ...(Number.isFinite(Number(entry.confidence)) ? { confidence: Number(entry.confidence) } : {}),
    })).filter((entry) => entry.text && entry.endMs > entry.startMs),
    placement: getCaptionPlacement(settings),
    displayMode: settings.displayMode,
    language,
  };
}

function getCaptionCueEntries(captionTrack) {
  if (!Array.isArray(captionTrack?.cues)) {
    return [];
  }

  return captionTrack.cues
    .map((cue) => ({
      start: Number(cue.startMs) / 1000,
      end: Number(cue.endMs) / 1000,
      text: String(cue.text || '').trim(),
    }))
    .filter((cue) => Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.end > cue.start && cue.text);
}

function getCaptionWordEntries(captionTrack) {
  if (!Array.isArray(captionTrack?.words)) {
    return [];
  }

  return captionTrack.words
    .map((word) => ({
      start: Number(word.startMs) / 1000,
      end: Number(word.endMs) / 1000,
      text: String(word.text || '').trim(),
      confidence: word.confidence,
    }))
    .filter((word) => Number.isFinite(word.start) && Number.isFinite(word.end) && word.end > word.start && word.text);
}

function getCaptionEntriesForDisplay(captionTrack, displayMode) {
  if (displayMode !== 'word') {
    return getCaptionCueEntries(captionTrack);
  }

  const words = getCaptionWordEntries(captionTrack);
  if (words.length > 0) {
    return words;
  }

  return getCaptionCueEntries(captionTrack).flatMap((entry) =>
    buildFallbackTranscriptWords(entry.text, entry.start, entry.end),
  );
}

function sliceCaptionTrack(captionTrack, clip) {
  if (!captionTrack) {
    return null;
  }

  const clipStartMs = Math.max(0, Math.round(Number(clip.startSeconds || 0) * 1000));
  const clipEndMs = Math.max(clipStartMs + 100, Math.round(Number(clip.endSeconds || 1) * 1000));
  const sliceEntries = (entries) => (Array.isArray(entries) ? entries : [])
    .filter((entry) => Number(entry.endMs) > clipStartMs && Number(entry.startMs) < clipEndMs)
    .map((entry) => ({
      ...entry,
      startMs: Math.max(0, Number(entry.startMs) - clipStartMs),
      endMs: Math.min(clipEndMs, Number(entry.endMs)) - clipStartMs,
    }))
    .filter((entry) => entry.endMs > entry.startMs);

  return {
    ...captionTrack,
    id: crypto.randomUUID(),
    cues: sliceEntries(captionTrack.cues),
    words: sliceEntries(captionTrack.words),
  };
}

async function prepareCaptionTrack(videoPath, video, settings) {
  const normalizedSettings = normalizeCaptionSettings(settings);
  if (normalizedSettings.mode === 'none') {
    return null;
  }

  const durationSeconds = Math.max(Number(video.durationSeconds || 1), 1);
  const fullClip = {
    startSeconds: 0,
    endSeconds: durationSeconds,
    durationSeconds,
  };
  const corrections = parseSubtitleCorrections(normalizedSettings.corrections);
  let entries;
  let words;
  let language = normalizedSettings.language;

  if (normalizedSettings.mode === 'manual') {
    entries = getManualSubtitleEntries(fullClip, normalizedSettings.manualText);
    if (normalizedSettings.language === 'pt-BR') {
      const translation = await translateSubtitleEntries(entries, normalizedSettings.language, 'auto');
      if (!translation.ok) {
        throw new Error(translation.error || 'A traducao automatica nao retornou legendas.');
      }
      entries = translation.entries;
      words = entries.flatMap((entry) => buildFallbackTranscriptWords(entry.text, entry.start, entry.end));
    } else {
      words = getManualSubtitleWordEntries(fullClip, normalizedSettings.manualText);
    }
  } else {
    const transcript = await getFullVideoTranscript(videoPath, video);
    if (!transcript?.ok) {
      throw new Error(transcript?.error || 'Transcricao automatica indisponivel.');
    }

    const sourceEntries = getClipSubtitleEntriesFromSegments(transcript.segments, fullClip);
    const sourceIsPortuguese = String(transcript.language || '').toLowerCase().startsWith('pt');
    const shouldTranslate = normalizedSettings.language === 'pt-BR' && !sourceIsPortuguese;
    entries = applySubtitleCorrections(sourceEntries, corrections);

    if (shouldTranslate) {
      const translation = await translateSubtitleEntries(entries, normalizedSettings.language, transcript.language || 'auto');
      if (!translation.ok) {
        throw new Error(translation.error || 'A traducao automatica nao retornou legendas.');
      }
      entries = translation.entries;
      words = entries.flatMap((entry) => buildFallbackTranscriptWords(entry.text, entry.start, entry.end));
      language = 'pt-BR';
    } else {
      words = getClipSubtitleWordEntriesFromSegments(transcript.segments, fullClip);
      language = normalizedSettings.language;
    }

    entries = splitSubtitleEntries(entries);
  }

  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('A transcricao nao encontrou fala para preparar as legendas.');
  }

  return buildCaptionTrack(entries, words, normalizedSettings, language);
}

function formatAssTimestamp(seconds) {
  const totalCentiseconds = Math.max(Math.round(Number(seconds || 0) * 100), 0);
  const hours = Math.floor(totalCentiseconds / 360000);
  const minutes = Math.floor((totalCentiseconds % 360000) / 6000);
  const wholeSeconds = Math.floor((totalCentiseconds % 6000) / 100);
  const centiseconds = totalCentiseconds % 100;

  return `${hours}:${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;
}

function escapeAssText(text) {
  return String(text || '').replace(/[{}]/g, '').replace(/\r?\n/g, ' ');
}

function groupSubtitleWords(entries, maxWords = 6, maxCharacters = 36) {
  const groups = [];
  let current = [];
  let currentCharacters = 0;

  for (const entry of entries) {
    const entryCharacters = String(entry.text || '').length;
    const hasGap = current.length > 0 && Number(entry.start) - Number(current[current.length - 1].end) > 0.75;
    const exceedsWords = current.length >= maxWords;
    const exceedsCharacters = current.length > 0 && currentCharacters + entryCharacters + 1 > maxCharacters;

    if (current.length > 0 && (hasGap || exceedsWords || exceedsCharacters)) {
      groups.push(current);
      current = [];
      currentCharacters = 0;
    }

    current.push(entry);
    currentCharacters += entryCharacters + (current.length > 1 ? 1 : 0);
  }

  if (current.length > 0) {
    groups.push(current);
  }

  return groups;
}

function toAssColor(value, fallback, alpha = 0) {
  const color = /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value).slice(1) : fallback.slice(1);
  const red = color.slice(0, 2);
  const green = color.slice(2, 4);
  const blue = color.slice(4, 6);
  const alphaHex = Math.round(Math.min(1, Math.max(0, Number(alpha))) * 255).toString(16).padStart(2, '0').toUpperCase();
  return `&H${alphaHex}${blue}${green}${red}`;
}

function writeAssFile(filePath, entries, fontName, position, canvasWidth = 1080, canvasHeight = 1920, captionStyle = {}, displayMode = 'word') {
  const normalizedStyle = normalizeCaptionSettings({ ...captionStyle, position: captionStyle.position || position });
  const isWordMode = displayMode === 'word';
  const groups = isWordMode ? groupSubtitleWords(entries) : entries.map((entry) => [entry]);
  const positionTag = `{\\an5\\pos(${Math.round(canvasWidth * normalizedStyle.positionX / 100)},${Math.round(canvasHeight * normalizedStyle.positionY / 100)})}`;
  const dialogue = groups.map((group) => {
    const text = isWordMode
      ? group
        .map((entry) => {
          const duration = Math.max(Math.round((Number(entry.end) - Number(entry.start)) * 100), 1);
          return `{\\kf${duration}}${escapeAssText(entry.text)}`;
        })
        .join(' ')
      : escapeAssText(group[0].text);
    const dialogueText = `${positionTag}${text}`;

    return `Dialogue: 0,${formatAssTimestamp(group[0].start)},${formatAssTimestamp(group[group.length - 1].end)},Default,,0,0,0,,${dialogueText}`;
  });
  const textColor = toAssColor(normalizedStyle.textColor, '#FFFFFF');
  const highlightColor = toAssColor(normalizedStyle.highlightColor, '#73DDBD');
  const primaryColor = isWordMode ? highlightColor : textColor;
  const secondaryColor = isWordMode ? textColor : highlightColor;
  const outlineColor = toAssColor(normalizedStyle.outlineColor, '#111111');
  const backgroundColor = toAssColor(normalizedStyle.backgroundColor, '#000000', 1 - normalizedStyle.backgroundOpacity);
  const content = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${canvasWidth}`,
    `PlayResY: ${canvasHeight}`,
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, TertiaryColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, AlphaLevel, Encoding',
    `Style: Default,${fontName || 'Arial'},${Math.round(normalizedStyle.fontSize)},${primaryColor},${secondaryColor},${outlineColor},${backgroundColor},0,0,3,${Math.round(normalizedStyle.outlineWidth)},0,5,40,40,40,0,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...dialogue,
    '',
  ].join('\n');

  fs.writeFileSync(filePath, content, 'utf8');
}

async function createSubtitleFile(packagePath, folderName, clipBaseName, video, clip, options) {
  if (options.subtitleMode === 'none') {
    return null;
  }

  if (options.captionTrack?.cues?.length || options.captionTrack?.words?.length) {
    const persistedEntries = getCaptionEntriesForDisplay(options.captionTrack, options.subtitleDisplayMode);
    return createSubtitleFileFromEntries(packagePath, folderName, clipBaseName, persistedEntries, [], {
      displayMode: options.subtitleDisplayMode,
      fontName: options.subtitleFontName,
      position: options.subtitlePosition,
      canvasWidth: options.canvasWidth,
      canvasHeight: options.canvasHeight,
      captionSettings: options.captionSettings,
    });
  }

  const manualEntries = options.subtitleMode === 'manual'
    ? getManualSubtitleEntries(clip, options.manualSubtitleText)
    : null;
  let entries = options.subtitleMode === 'manual'
    ? options.subtitleDisplayMode === 'word'
      ? getManualSubtitleWordEntries(clip, options.manualSubtitleText)
      : manualEntries
    : getAutomaticSubtitleEntries(video, clip);
  let correctionsForOutput = options.subtitleCorrections;

  if (options.subtitleLanguage === 'pt-BR') {
    const translationSource = options.subtitleMode === 'manual' ? manualEntries : entries;
    const correctedEntries = applySubtitleCorrections(translationSource || [], options.subtitleCorrections);
    const translation = await translateSubtitleEntries(correctedEntries, options.subtitleLanguage, 'auto');
    if (!translation.ok) {
      return { error: translation.error };
    }
    entries = options.subtitleDisplayMode === 'word'
      ? translation.entries.flatMap((entry) => buildFallbackTranscriptWords(entry.text, entry.start, entry.end))
      : translation.entries;
    correctionsForOutput = [];
  }

  return createSubtitleFileFromEntries(packagePath, folderName, clipBaseName, entries, correctionsForOutput, {
    displayMode: options.subtitleDisplayMode,
    fontName: options.subtitleFontName,
    position: options.subtitlePosition,
    canvasWidth: options.canvasWidth,
    canvasHeight: options.canvasHeight,
    captionSettings: options.captionSettings,
  });
}

function createSubtitleFileFromEntries(packagePath, folderName, clipBaseName, entries, corrections = [], options = {}) {
  const correctedEntries = applySubtitleCorrections(entries, corrections);

  if (!Array.isArray(correctedEntries) || correctedEntries.length === 0) {
    return null;
  }

  const isWordMode = options.displayMode === 'word';
  const fileName = `${clipBaseName}.ass`;
  const filePath = path.join(packagePath, fileName);
  writeAssFile(
    filePath,
    correctedEntries,
    options.fontName,
    options.position,
    options.canvasWidth,
    options.canvasHeight,
    options.captionSettings,
    isWordMode ? 'word' : 'block',
  );

  return {
    fileName,
    filePath,
    url: `/gallery/${folderName}/${fileName}`,
    entries: correctedEntries.length,
  };
}

async function getFullVideoTranscript(videoPath, video) {
  const savedSegments = getSavedTranscriptSegments(video);
  const savedVersion = Number(video.analysis?.tools?.whisperx?.transcriptionVersion || 0);
  if (savedSegments.length > 0 && savedVersion >= 3) {
    return {
      ok: true,
      source: 'saved-whisperx',
      transcriptionVersion: savedVersion,
      language: video.analysis?.tools?.whisperx?.language || null,
      segments: savedSegments,
    };
  }

  try {
    const transcription = await runPythonJson(
      'transcribe_clip.py',
      [
        '--video',
        videoPath,
        '--start',
        '0',
        '--duration',
        String(Math.max(Number(video.durationSeconds || 1), 1)),
      ],
      20 * 60 * 1000,
    );

    if (transcription?.ok && Array.isArray(transcription.segments) && transcription.segments.length > 0) {
      updateVideo(video.id, (currentVideo) => ({
        ...currentVideo,
        analysis: {
          ...(currentVideo.analysis || {}),
          tools: {
            ...(currentVideo.analysis?.tools || {}),
            whisperx: {
              ...(currentVideo.analysis?.tools?.whisperx || {}),
              ...transcription,
            },
          },
        },
      }));

      return {
        ok: true,
        source: transcription.engine || 'transcribe_clip',
        transcriptionVersion: Number(transcription.transcriptionVersion || 3),
        language: transcription.language || null,
        segments: normalizeTranscriptSegments(transcription.segments),
      };
    }

    return {
      ok: false,
      error: transcription?.message || 'A transcricao automatica nao retornou segmentos.',
    };
  } catch (error) {
    console.error(`[captions] transcription failed for video ${video.id}: ${error.message}`);
    return {
      ok: false,
      error: `Falha ao executar o transcritor automatico: ${error.message}`,
    };
  }
}

async function translateSubtitleEntries(entries, targetLanguage, sourceLanguage = 'auto') {
  if (targetLanguage !== 'pt-BR') {
    return { ok: true, entries };
  }

  const translationDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcut-translation-'));
  const inputPath = path.join(translationDir, 'entries.json');
  fs.writeFileSync(inputPath, JSON.stringify(entries), 'utf8');

  try {
    const translation = await runPythonJson(
      'translate_subtitles.py',
      ['--input', inputPath, '--source-language', sourceLanguage || 'auto'],
      5 * 60 * 1000,
    );

    if (!translation?.ok || !Array.isArray(translation.entries)) {
      return {
        ok: false,
        error: translation?.error || 'A traducao automatica nao retornou legendas.',
      };
    }

    return { ok: true, entries: translation.entries, source: translation.model };
  } catch (error) {
    console.error(`[captions] translation failed: ${error.message}`);
    return {
      ok: false,
      error: `Falha ao traduzir legendas: ${error.message}`,
    };
  } finally {
    fs.rmSync(translationDir, { recursive: true, force: true });
  }
}

async function createAutomaticSubtitleFile(packagePath, folderName, clipBaseName, transcript, clip, corrections, options = {}) {
  const persistedCaptionTrack = options.captionTrack;
  if (persistedCaptionTrack?.cues?.length || persistedCaptionTrack?.words?.length) {
    const persistedEntries = getCaptionEntriesForDisplay(persistedCaptionTrack, options.displayMode);
    return createSubtitleFileFromEntries(packagePath, folderName, clipBaseName, persistedEntries, [], options);
  }

  if (!transcript?.ok) {
    return {
      error: transcript?.error || 'Transcricao automatica indisponivel.',
    };
  }

  const sourceEntries = getClipSubtitleEntriesFromSegments(transcript.segments, clip);
  let translatedEntries = sourceEntries;
  let correctionsForOutput = corrections;

  const sourceIsPortuguese = String(transcript.language || '').toLowerCase().startsWith('pt');
  const shouldTranslate = options.subtitleLanguage === 'pt-BR' && !sourceIsPortuguese;
  if (shouldTranslate) {
    const correctedSourceEntries = applySubtitleCorrections(sourceEntries, corrections);
    const translation = await translateSubtitleEntries(
      correctedSourceEntries,
      options.subtitleLanguage,
      transcript.language || 'auto',
    );
    if (!translation.ok) {
      return { error: translation.error };
    }
    translatedEntries = translation.entries;
    correctionsForOutput = [];
  }

  const entries = options.displayMode === 'word'
    ? shouldTranslate
      ? translatedEntries.flatMap((entry) => buildFallbackTranscriptWords(entry.text, entry.start, entry.end))
      : getClipSubtitleWordEntriesFromSegments(transcript.segments, clip)
    : splitSubtitleEntries(translatedEntries);
  if (entries.length === 0) {
    return {
      error: 'A transcricao nao encontrou fala dentro deste corte.',
    };
  }

  return createSubtitleFileFromEntries(packagePath, folderName, clipBaseName, entries, correctionsForOutput, options);
}

function escapeSubtitleFilterPath(filePath) {
  return filePath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

function buildSubtitleFilter(subtitlePath, fontName, position, canvasWidth = 1080, canvasHeight = 1920, captionSettings = {}) {
  if (path.extname(subtitlePath).toLowerCase() === '.ass') {
    return `ass='${escapeSubtitleFilterPath(subtitlePath)}'`;
  }

  const normalizedStyle = normalizeCaptionSettings({ ...captionSettings, position: captionSettings.position || position });
  const alignment = getSubtitleAlignment(normalizedStyle.position);
  const style = [
    `FontName=${fontName}`,
    `FontSize=${Math.round(normalizedStyle.fontSize)}`,
    `PrimaryColour=${toAssColor(normalizedStyle.textColor, '#FFFFFF')}`,
    `OutlineColour=${toAssColor(normalizedStyle.outlineColor, '#111111')}`,
    'BorderStyle=3',
    `Outline=${Math.round(normalizedStyle.outlineWidth)}`,
    'Shadow=0',
    `Alignment=${alignment}`,
    `MarginV=${Math.round(canvasHeight * (100 - normalizedStyle.positionY) / 100)}`,
    `MarginL=${Math.round(canvasWidth * normalizedStyle.positionX / 100)}`,
    `MarginR=${Math.round(canvasWidth * (100 - normalizedStyle.positionX) / 100)}`,
  ].join(',');

  return `subtitles='${escapeSubtitleFilterPath(subtitlePath)}':original_size=${canvasWidth}x${canvasHeight}:force_style='${style}'`;
}

function getCompositionRegionForItem(composition, item) {
  return composition?.layout?.regions?.find((region) => region.id === item?.regionId) || composition?.layout?.regions?.[0] || {
    xPct: 0,
    yPct: 0,
    widthPct: 100,
    heightPct: 100,
  };
}

function getObjectPositionPercent(value) {
  const numericValue = Number(value);
  const safeValue = Number.isFinite(numericValue) ? numericValue : 0;
  return Math.min(100, Math.max(0, 50 + safeValue / 2));
}

function formatFilterNumber(value) {
  return String(Number(Number(value).toFixed(4)));
}

function buildCompositionRender(composition, project, durationSeconds, subtitleOptions = null) {
  const canvasWidth = Math.max(320, Math.round(Number(composition.canvas.width || 1080)));
  const canvasHeight = Math.max(320, Math.round(Number(composition.canvas.height || 1920)));
  const fps = Math.max(1, Number(composition.canvas.fps || 30));
  const background = /^#[0-9a-f]{6}$/i.test(String(composition.layout.background || ''))
    ? `0x${composition.layout.background.slice(1)}`
    : 'black';
  const videoTrack = composition.tracks?.find((track) => track.kind === 'video');
  const videoItem = videoTrack?.items?.[0];
  const region = getCompositionRegionForItem(composition, videoItem);
  const regionX = Math.max(0, Math.min(canvasWidth - 2, Math.round(canvasWidth * Number(region.xPct || 0) / 100)));
  const regionY = Math.max(0, Math.min(canvasHeight - 2, Math.round(canvasHeight * Number(region.yPct || 0) / 100)));
  const regionWidth = Math.max(2, Math.min(canvasWidth - regionX, Math.round(canvasWidth * Number(region.widthPct || 100) / 100)));
  const regionHeight = Math.max(2, Math.min(canvasHeight - regionY, Math.round(canvasHeight * Number(region.heightPct || 100) / 100)));
  const transform = videoItem?.transform || { x: 0, y: 0, scale: 1, cropMode: 'cover', rotation: 0 };
  const scale = Math.max(0.5, Math.min(3, Number(transform.scale || 1)));
  const rotation = Math.max(-180, Math.min(180, Number(transform.rotation || 0)));
  const rotationFilter = rotation === 0
    ? ''
    : `format=rgba,rotate=${(rotation * Math.PI / 180).toFixed(6)}:ow=rotw(iw):oh=roth(ih):c=black@0`;
  const scaledWidth = Math.max(2, Math.round(regionWidth * scale));
  const scaledHeight = Math.max(2, Math.round(regionHeight * scale));
  const positionX = formatFilterNumber(getObjectPositionPercent(transform.x) / 100);
  const positionY = formatFilterNumber(getObjectPositionPercent(transform.y) / 100);
  const cropX = `(iw-${scaledWidth})*${positionX}`;
  const cropY = `(ih-${scaledHeight})*${positionY}`;
  const videoFilter = transform.cropMode === 'contain'
    ? `scale=${scaledWidth}:${scaledHeight}:force_original_aspect_ratio=decrease,pad=${scaledWidth}:${scaledHeight}:(ow-iw)*${positionX}:(oh-ih)*${positionY}:color=black@0`
    : `scale=${scaledWidth}:${scaledHeight}:force_original_aspect_ratio=increase,crop=${scaledWidth}:${scaledHeight}:${cropX}:${cropY}`;
  const composedVideoFilter = ['format=rgba', videoFilter, rotationFilter].filter(Boolean).join(',');
  const filters = [
    `color=c=${background}:s=${canvasWidth}x${canvasHeight}:r=${fps}:d=${Math.max(durationSeconds, 1)}[base0]`,
    `[0:v]setpts=PTS-STARTPTS,${composedVideoFilter}[videoFrame]`,
    `color=c=black@0:s=${regionWidth}x${regionHeight}:r=${fps}:d=${Math.max(durationSeconds, 1)},format=rgba[videoRegionBase]`,
    `[videoRegionBase][videoFrame]overlay=(${regionWidth}-overlay_w)/2:(${regionHeight}-overlay_h)/2:format=auto:eof_action=pass[video0]`,
    `[base0][video0]overlay=${regionX}:${regionY}:format=auto:eof_action=pass[layout0]`,
  ];
  const inputPaths = [];
  let currentLabel = 'layout0';
  const mediaItems = composition.tracks?.filter((track) => track.kind === 'media').flatMap((track) => track.items || []) || [];

  mediaItems.forEach((item) => {
    const asset = project?.assets?.find((currentAsset) => currentAsset.id === item.assetId && currentAsset.type === 'image');
    if (!asset?.fileName) {
      return;
    }

    let assetPath;
    try {
      assetPath = getSafeProjectAssetPath(asset.fileName);
    } catch {
      return;
    }

    if (!fs.existsSync(assetPath)) {
      return;
    }

    const mediaRegion = getCompositionRegionForItem(composition, item);
    const mediaX = Math.max(0, Math.min(canvasWidth - 2, Math.round(canvasWidth * Number(mediaRegion.xPct || 0) / 100)));
    const mediaY = Math.max(0, Math.min(canvasHeight - 2, Math.round(canvasHeight * Number(mediaRegion.yPct || 0) / 100)));
    const mediaWidth = Math.max(2, Math.min(canvasWidth - mediaX, Math.round(canvasWidth * Number(mediaRegion.widthPct || 100) / 100)));
    const mediaHeight = Math.max(2, Math.min(canvasHeight - mediaY, Math.round(canvasHeight * Number(mediaRegion.heightPct || 100) / 100)));
    const mediaTransform = item.transform || { x: 0, y: 0, scale: 0.35, cropMode: 'contain', rotation: 0 };
    const mediaScale = Math.max(0.1, Math.min(3, Number(mediaTransform.scale || 1)));
    const imageWidth = Math.max(2, Math.round(mediaWidth * mediaScale));
    const imageHeight = Math.max(2, Math.round(mediaHeight * mediaScale));
    const imageOffsetX = formatFilterNumber(Number(mediaTransform.x || 0) * mediaWidth / 200);
    const imageOffsetY = formatFilterNumber(Number(mediaTransform.y || 0) * mediaHeight / 200);
    const imageRotation = Math.max(-180, Math.min(180, Number(mediaTransform.rotation || 0)));
    const imageRotationFilter = imageRotation === 0
      ? ''
      : `format=rgba,rotate=${(imageRotation * Math.PI / 180).toFixed(6)}:ow=rotw(iw):oh=roth(ih):c=black@0`;
    const inputIndex = inputPaths.length + 1;
    const imageLabel = `image${inputIndex}`;
    const nextLabel = `layout${inputIndex}`;
    inputPaths.push(assetPath);
    const imageFilter = mediaTransform.cropMode === 'contain'
      ? `scale=${imageWidth}:${imageHeight}:force_original_aspect_ratio=decrease,pad=${imageWidth}:${imageHeight}:(ow-iw)/2:(oh-ih)/2:color=black@0`
      : `scale=${imageWidth}:${imageHeight}:force_original_aspect_ratio=increase,crop=${imageWidth}:${imageHeight}:(iw-${imageWidth})/2:(ih-${imageHeight})/2`;
    const composedImageFilter = ['format=rgba', imageFilter, imageRotationFilter].filter(Boolean).join(',');
    filters.push(`[${inputIndex}:v]${composedImageFilter}[${imageLabel}]`);
    filters.push(`color=c=black@0:s=${mediaWidth}x${mediaHeight}:r=${fps}:d=${Math.max(durationSeconds, 1)},format=rgba[${imageLabel}Base]`);
    filters.push(`[${imageLabel}Base][${imageLabel}]overlay=${imageOffsetX}+(${mediaWidth}-overlay_w)/2:${imageOffsetY}+(${mediaHeight}-overlay_h)/2:format=auto:eof_action=pass[${imageLabel}Layer]`);
    filters.push(`[${currentLabel}][${imageLabel}Layer]overlay=${mediaX}:${mediaY}:format=auto:eof_action=pass[${nextLabel}]`);
    currentLabel = nextLabel;
  });

  let outputLabel = currentLabel;
  if (subtitleOptions?.subtitlePath) {
    filters.push(`[${currentLabel}]${buildSubtitleFilter(subtitleOptions.subtitlePath, subtitleOptions.fontName, subtitleOptions.position, canvasWidth, canvasHeight, subtitleOptions.captionSettings)}[captioned]`);
    outputLabel = 'captioned';
  }

  return {
    filterComplex: filters.join(';'),
    inputPaths,
    outputLabel,
  };
}

function exportClipWithFfmpeg(
  sourcePath,
  targetPath,
  clip,
  subtitleOptions = null,
  composition = null,
  project = null,
  shouldCancel = () => false,
) {
  const ffmpegBin = findExecutable('ffmpeg', 'FFMPEG_BIN');

  if (!ffmpegBin) {
    return Promise.resolve({ ok: false, mode: 'missing', message: 'ffmpeg nao encontrado.' });
  }

  const command = [
    '-y',
    '-ss',
    String(Math.max(Number(clip.startSeconds || 0), 0)),
    '-i',
    sourcePath,
  ];

  const durationSeconds = Math.max(Number(clip.durationSeconds || 1), 1);
  const compositionRender = composition
    ? buildCompositionRender(composition, project, durationSeconds, subtitleOptions)
    : null;

  if (compositionRender) {
    compositionRender.inputPaths.forEach((inputPath) => command.push('-loop', '1', '-i', inputPath));
    command.push(
      '-t',
      String(durationSeconds),
      '-filter_complex',
      compositionRender.filterComplex,
      '-map',
      `[${compositionRender.outputLabel}]`,
      '-map',
      '0:a?',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '23',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
    );
  } else if (subtitleOptions?.subtitlePath) {
    command.push(
      '-t',
      String(durationSeconds),
      '-vf',
      buildSubtitleFilter(subtitleOptions.subtitlePath, subtitleOptions.fontName, subtitleOptions.position, 1080, 1920, subtitleOptions.captionSettings),
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '23',
      '-c:a',
      'copy',
    );
  } else {
    command.push('-t', String(durationSeconds), '-c', 'copy');
  }

  command.push('-avoid_negative_ts', 'make_zero', targetPath);

  if (shouldCancel()) {
    return Promise.resolve({ ok: false, cancelled: true, mode: 'cancelled', message: 'Exportacao cancelada.' });
  }

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(ffmpegBin, command, { encoding: 'utf8', windowsHide: true });
    } catch (error) {
      resolve({
        ok: false,
        mode: 'error',
        code: error.code || 'SPAWN_FAILED',
        message: error.message || 'Nao foi possivel iniciar o ffmpeg.',
      });
      return;
    }
    let stderr = '';
    let settled = false;
    let cancelled = false;
    const cancellationTimer = setInterval(() => {
      if (shouldCancel() && !cancelled) {
        cancelled = true;
        try {
          child.kill();
        } catch {
          // O processo pode já ter terminado entre a verificação e o kill.
        }
      }
    }, 200);

    const finish = (result) => {
      if (settled) {
        return;
      }

      settled = true;
      clearInterval(cancellationTimer);
      resolve(result);
    };

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      finish({ ok: false, mode: 'error', message: error.message });
    });
    child.on('close', (code) => {
      if (cancelled || shouldCancel()) {
        finish({ ok: false, cancelled: true, mode: 'cancelled', message: 'Exportacao cancelada.' });
        return;
      }

      if (code === 0 && fs.existsSync(targetPath)) {
        finish({
          ok: true,
          mode: compositionRender ? 'ffmpeg-layout' : subtitleOptions?.subtitlePath ? 'ffmpeg-subtitle' : 'ffmpeg-copy',
        });
        return;
      }

      finish({ ok: false, mode: 'error', message: stderr || 'Falha ao recortar com ffmpeg.' });
    });
  });
}

function runPythonJson(scriptName, args = [], timeoutMs = 10 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_BIN, [path.join(AI_DIR, scriptName), ...args], {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        MPLCONFIGDIR: process.env.MPLCONFIGDIR || MATPLOTLIB_CACHE_DIR,
      },
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Python script timed out: ${scriptName}`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);

      if (code !== 0) {
        reject(new Error(stderr || `Python script exited with code ${code}`));
        return;
      }

      try {
        resolve(JSON.parse(stdout.trim().split(/\r?\n/).at(-1) || '{}'));
      } catch (error) {
        reject(new Error(`Invalid JSON from ${scriptName}: ${error.message}`));
      }
    });
  });
}

function resolveYtDlpCommand() {
  const configuredBinary = findExecutable('yt-dlp', 'YTDLP_BIN');
  const isUnresolvedPosixCommand = process.platform !== 'win32' && configuredBinary === 'yt-dlp';
  if (configuredBinary && !isUnresolvedPosixCommand) {
    return { binary: configuredBinary, prefixArgs: [] };
  }

  return PYTHON_BIN ? { binary: PYTHON_BIN, prefixArgs: ['-m', 'yt_dlp'] } : null;
}

function runExternalCommand(binary, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    let child;
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }

      try {
        child?.kill();
      } catch {
        // O processo pode ja ter terminado no mesmo instante do timeout.
      }
      settled = true;
      reject(new Error('O download do video excedeu o tempo limite.'));
    }, timeoutMs);

    const finish = (callback) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      callback();
    };

    try {
      child = spawn(binary, args, {
        cwd: ROOT_DIR,
        env: process.env,
        windowsHide: true,
      });
    } catch (error) {
      finish(() => reject(error));
      return;
    }

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => finish(() => reject(error)));
    child.on('close', (code) => {
      finish(() => {
        if (code !== 0) {
          reject(new Error(stderr.trim() || `Comando externo terminou com codigo ${code}.`));
          return;
        }

        resolve({ stdout, stderr });
      });
    });
  });
}

function normalizeImportUrl(value) {
  let parsedUrl;
  try {
    parsedUrl = new URL(String(value || '').trim());
  } catch {
    throw new Error('Informe um link de video valido.');
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) {
    throw new Error('O link precisa usar HTTP ou HTTPS e nao pode conter credenciais.');
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  const isLocalHost = hostname === 'localhost' || hostname === '::1' || /^127\./.test(hostname) || /^0\.0\.0\.0$/.test(hostname);
  if (isLocalHost) {
    throw new Error('Links para enderecos locais nao podem ser importados.');
  }

  return parsedUrl.href;
}

function getImportProvider(url) {
  const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  if (hostname === 'youtube.com' || hostname.endsWith('.youtube.com') || hostname === 'youtu.be') {
    return 'youtube';
  }

  return 'external';
}

function parseDumpedMetadata(stdout) {
  const text = String(stdout || '').trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) {
      throw new Error('O provedor nao retornou os metadados do video.');
    }

    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      throw new Error('Os metadados retornados pelo provedor sao invalidos.');
    }
  }
}

function extractJsonVariable(html, variableName) {
  const markers = [`var ${variableName} =`, `${variableName} =`];
  for (const marker of markers) {
    const markerIndex = html.indexOf(marker);
    if (markerIndex === -1) {
      continue;
    }

    const start = html.indexOf('{', markerIndex + marker.length);
    if (start === -1) {
      continue;
    }

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < html.length; index += 1) {
      const character = html[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (character === '\\') {
          escaped = true;
        } else if (character === '"') {
          inString = false;
        }
        continue;
      }

      if (character === '"') {
        inString = true;
      } else if (character === '{') {
        depth += 1;
      } else if (character === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(html.slice(start, index + 1));
          } catch {
            break;
          }
        }
      }
    }
  }

  return null;
}

function collectHeatmapMarkers(value, markers = [], visited = new Set()) {
  if (!value || typeof value !== 'object' || visited.has(value)) {
    return markers;
  }

  visited.add(value);
  if (value.heatMarkerRenderer && typeof value.heatMarkerRenderer === 'object') {
    const renderer = value.heatMarkerRenderer;
    const startMilliseconds = Number(
      renderer.markerOffsetFromStartMillis ?? renderer.timeRangeStartMillis ?? renderer.startMillis,
    );
    const durationMilliseconds = Number(renderer.markerDurationMillis ?? renderer.durationMillis);
    const intensity = Number(
      renderer.heatMarkerIntensityScoreNormalized ?? renderer.heatMarkerIntensityScore ?? renderer.intensity,
    );

    if (Number.isFinite(startMilliseconds) && Number.isFinite(durationMilliseconds) && durationMilliseconds > 0 && Number.isFinite(intensity)) {
      markers.push({
        startSeconds: Math.max(0, startMilliseconds / 1000),
        endSeconds: Math.max(0, (startMilliseconds + durationMilliseconds) / 1000),
        intensity: Math.min(1, Math.max(0, intensity)),
      });
    }
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectHeatmapMarkers(item, markers, visited));
  } else {
    Object.values(value).forEach((item) => collectHeatmapMarkers(item, markers, visited));
  }

  return markers;
}

function extractSvgHeatmapMarkers(html, durationSeconds) {
  const paths = [];
  for (const tagMatch of String(html || '').matchAll(/<path\b[^>]*>/gi)) {
    const tag = tagMatch[0];
    const classMatch = tag.match(/\bclass=["']([^"']+)["']/i);
    const pathMatch = tag.match(/\bd=["']([^"']+)["']/i);
    if (classMatch && pathMatch && /ytp-(?:modern-)?heat-map/i.test(classMatch[1])) {
      paths.push(pathMatch[1]);
    }
  }

  const markers = [];
  for (const pathData of paths) {
    const points = [];
    for (const curveMatch of pathData.matchAll(/C\s*(-?[\d.]+),(-?[\d.]+)\s+(-?[\d.]+),(-?[\d.]+)\s+(-?[\d.]+),(-?[\d.]+)/gi)) {
      const x = Number(curveMatch[5]);
      const y = Number(curveMatch[6]);
      if (Number.isFinite(x) && Number.isFinite(y) && x >= 5 && x <= 1005 && y >= 0 && y <= 100) {
        points.push({ x, y });
      }
    }

    points.forEach((point, index) => {
      const nextPoint = points[index + 1];
      const startRatio = Math.min(1, Math.max(0, (point.x - 5) / 1000));
      const nextRatio = nextPoint
        ? Math.min(1, Math.max(startRatio, (nextPoint.x - 5) / 1000))
        : Math.min(1, startRatio + 1 / Math.max(durationSeconds, 1));
      const startSeconds = startRatio * durationSeconds;
      const endSeconds = Math.min(durationSeconds, Math.max(startSeconds + 0.5, nextRatio * durationSeconds));
      markers.push({
        startSeconds,
        endSeconds,
        intensity: Math.min(1, Math.max(0, (100 - point.y) / 100)),
      });
    });
  }

  return markers;
}

function buildAudienceRecommendations(markers, durationSeconds) {
  const maxRecommendations = Math.min(12, getMaxClipCount(durationSeconds));
  const maxStart = Math.max(0, durationSeconds - MIN_CLIP_DURATION_SECONDS);
  const candidates = markers.map((marker) => {
    const center = (marker.startSeconds + marker.endSeconds) / 2;
    const startSeconds = Math.max(0, Math.min(maxStart, center - MIN_CLIP_DURATION_SECONDS / 2));
    const endSeconds = Math.min(durationSeconds, startSeconds + MIN_CLIP_DURATION_SECONDS);
    const overlaps = markers.filter((currentMarker) => currentMarker.endSeconds > startSeconds && currentMarker.startSeconds < endSeconds);
    const totalOverlap = overlaps.reduce((total, currentMarker) => {
      return total + Math.max(0, Math.min(endSeconds, currentMarker.endSeconds) - Math.max(startSeconds, currentMarker.startSeconds));
    }, 0);
    const weightedIntensity = totalOverlap > 0
      ? overlaps.reduce((total, currentMarker) => {
          const overlap = Math.max(0, Math.min(endSeconds, currentMarker.endSeconds) - Math.max(startSeconds, currentMarker.startSeconds));
          return total + currentMarker.intensity * overlap;
        }, 0) / totalOverlap
      : marker.intensity;

    return {
      startSeconds: Number(startSeconds.toFixed(1)),
      endSeconds: Number(endSeconds.toFixed(1)),
      durationSeconds: Number((endSeconds - startSeconds).toFixed(1)),
      intensity: Number(weightedIntensity.toFixed(3)),
    };
  });
  const uniqueCandidates = Array.from(new Map(candidates.map((candidate) => [candidate.startSeconds, candidate])).values());
  const selected = [];

  for (const candidate of uniqueCandidates.sort((first, second) => second.intensity - first.intensity)) {
    if (selected.length >= maxRecommendations) {
      break;
    }

    if (selected.some((current) => candidate.startSeconds < current.endSeconds && candidate.endSeconds > current.startSeconds)) {
      continue;
    }

    selected.push(candidate);
  }

  return selected
    .sort((first, second) => first.startSeconds - second.startSeconds)
    .map((candidate, index) => ({
      id: `youtube-most-replayed-${index + 1}`,
      ...candidate,
      score: Math.round(candidate.intensity * 100),
      source: 'youtube-most-replayed',
      rank: index + 1,
    }));
}

async function getYouTubeAudienceRecommendations(url, durationSeconds) {
  if (getImportProvider(url) !== 'youtube') {
    return {
      source: null,
      available: false,
      markers: 0,
      recommendations: [],
      message: null,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const pageResponse = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 ClipCut/1.0' },
      signal: controller.signal,
    });
    if (!pageResponse.ok) {
      throw new Error(`YouTube respondeu HTTP ${pageResponse.status}.`);
    }

    const html = await pageResponse.text();
    const documents = [
      extractJsonVariable(html, 'ytInitialData'),
      extractJsonVariable(html, 'ytInitialPlayerResponse'),
    ].filter(Boolean);
    const markers = [
      ...documents.flatMap((document) => collectHeatmapMarkers(document)),
      ...extractSvgHeatmapMarkers(html, durationSeconds),
    ]
      .filter((marker, index, all) => all.findIndex((item) => item.startSeconds === marker.startSeconds) === index)
      .filter((marker) => marker.startSeconds < durationSeconds);
    const recommendations = buildAudienceRecommendations(markers, durationSeconds);

    return {
      source: 'youtube-most-replayed',
      available: recommendations.length > 0,
      markers: markers.length,
      recommendations,
      message: recommendations.length > 0
        ? 'Minutagens baseadas no grafico publico de momentos mais assistidos.'
        : 'Este video nao disponibilizou o grafico publico de momentos mais assistidos.',
    };
  } catch (error) {
    return {
      source: 'youtube-most-replayed',
      available: false,
      markers: 0,
      recommendations: [],
      message: error?.name === 'AbortError'
        ? 'A consulta de audiencia do YouTube expirou; o video foi importado sem recomendacoes.'
        : `Nao foi possivel obter a audiencia do YouTube: ${error?.message || 'erro desconhecido'}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function findDownloadedVideo(fileStem) {
  const candidates = fs.readdirSync(VIDEOS_DIR)
    .filter((fileName) => fileName.startsWith(`${fileStem}.`) && !fileName.endsWith('.part'))
    .map((fileName) => {
      const filePath = path.join(VIDEOS_DIR, fileName);
      return { fileName, filePath, size: fs.statSync(filePath).size };
    })
    .filter((candidate) => candidate.size > 0)
    .sort((first, second) => second.size - first.size);

  return candidates[0] || null;
}

function removeDownloadedCandidates(fileStem) {
  if (!fs.existsSync(VIDEOS_DIR)) {
    return;
  }

  fs.readdirSync(VIDEOS_DIR)
    .filter((fileName) => fileName.startsWith(`${fileStem}.`))
    .forEach((fileName) => {
      try {
        fs.unlinkSync(path.join(VIDEOS_DIR, fileName));
      } catch {
        // A limpeza best-effort nao deve esconder o erro principal da importacao.
      }
    });
}

async function importVideoFromUrl(rawUrl) {
  const sourceUrl = normalizeImportUrl(rawUrl);
  const command = resolveYtDlpCommand();
  if (!command) {
    const error = new Error('yt-dlp nao encontrado. Instale o yt-dlp ou configure YTDLP_BIN para importar links.');
    error.code = 'YTDLP_MISSING';
    throw error;
  }

  let metadataResult;
  try {
    metadataResult = await runExternalCommand(
      command.binary,
      [...command.prefixArgs, '--dump-single-json', '--skip-download', '--no-playlist', '--no-warnings', '--no-progress', sourceUrl],
      2 * 60 * 1000,
    );
  } catch (error) {
    if (command.prefixArgs[0] === '-m' && /No module named ['\"]?yt_dlp['\"]?/.test(error?.message || '')) {
      const missingDependency = new Error('yt-dlp nao esta instalado. Execute python -m pip install -U yt-dlp para importar links.');
      missingDependency.code = 'YTDLP_MISSING';
      throw missingDependency;
    }

    throw error;
  }
  const metadata = parseDumpedMetadata(metadataResult.stdout);
  const durationSeconds = Number(metadata.duration);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error('O provedor nao informou uma duracao valida; transmissao ao vivo nao e suportada.');
  }

  if (durationSeconds < MIN_CLIP_DURATION_SECONDS) {
    throw new Error('O video do link precisa ter pelo menos 1 minuto.');
  }

  if (durationSeconds > MAX_VIDEO_DURATION_SECONDS) {
    throw new Error('O video do link ultrapassa o limite de 1 hora.');
  }

  const fileStem = `${Date.now()}-${crypto.randomUUID()}-${sanitizeFileName(metadata.title || 'video-importado').slice(0, 80) || 'video-importado'}`;
  const outputTemplate = path.join(VIDEOS_DIR, `${fileStem}.%(ext)s`);

  try {
    await runExternalCommand(
      command.binary,
      [
        ...command.prefixArgs,
        '--no-playlist',
        '--no-warnings',
        '--no-progress',
        '--format',
        'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b',
        '--merge-output-format',
        'mp4',
        '--output',
        outputTemplate,
        sourceUrl,
      ],
      2 * 60 * 60 * 1000,
    );

    const downloaded = findDownloadedVideo(fileStem);
    if (!downloaded) {
      throw new Error('O provedor concluiu sem produzir um arquivo de video.');
    }

    const audience = await getYouTubeAudienceRecommendations(sourceUrl, durationSeconds);
    const extension = path.extname(downloaded.fileName).toLowerCase();
    const importedVideo = {
      id: crypto.randomUUID(),
      originalName: `${metadata.title || 'Video importado'}${extension}`,
      fileName: downloaded.fileName,
      type: extension === '.webm' ? 'video/webm' : 'video/mp4',
      size: downloaded.size,
      durationSeconds,
      createdAt: new Date().toISOString(),
      url: `/videos/${downloaded.fileName}`,
      sourceType: 'url',
      sourceUrl,
      sourceProvider: getImportProvider(sourceUrl),
      audienceRecommendations: audience.recommendations,
      audienceInsight: {
        source: audience.source,
        available: audience.available,
        markers: audience.markers,
        message: audience.message,
        fetchedAt: new Date().toISOString(),
      },
      aiStatus: 'pending',
      analysis: null,
    };

    const videos = readManifest();
    videos.push(importedVideo);
    writeManifest(videos);
    return importedVideo;
  } catch (error) {
    removeDownloadedCandidates(fileStem);
    throw error;
  }
}

const storage = multer.diskStorage({
  destination: (_request, _file, callback) => {
    callback(null, VIDEOS_DIR);
  },
  filename: (_request, file, callback) => {
    const extension = path.extname(file.originalname);
    const baseName = path.basename(file.originalname, extension);
    const safeBaseName = sanitizeFileName(baseName) || 'video';
    callback(null, `${Date.now()}-${crypto.randomUUID()}-${safeBaseName}${extension}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 1024 * 1024 * 1024,
  },
  fileFilter: (_request, file, callback) => {
    if (!file.mimetype.startsWith('video/')) {
      callback(new Error('INVALID_VIDEO_TYPE'));
      return;
    }

    callback(null, true);
  },
});

const projectAssetStorage = multer.diskStorage({
  destination: (_request, _file, callback) => {
    callback(null, PROJECT_ASSETS_DIR);
  },
  filename: (_request, file, callback) => {
    const extension = path.extname(file.originalname);
    const baseName = path.basename(file.originalname, extension);
    const safeBaseName = sanitizeFileName(baseName) || 'image';
    callback(null, `${Date.now()}-${crypto.randomUUID()}-${safeBaseName}${extension}`);
  },
});

const imageUpload = multer({
  storage: projectAssetStorage,
  limits: {
    fileSize: 25 * 1024 * 1024,
  },
  fileFilter: (_request, file, callback) => {
    if (!file.mimetype.startsWith('image/')) {
      callback(new Error('INVALID_IMAGE_TYPE'));
      return;
    }

    callback(null, true);
  },
});

const app = express();

app.use(cors());
app.use(express.json());
app.use('/videos', express.static(VIDEOS_DIR));
app.use('/gallery', express.static(GALLERY_DIR));
app.use('/project-assets', express.static(PROJECT_ASSETS_DIR));

app.get('/api/health', (_request, response) => {
  response.json({ ok: true });
});

app.get('/api/ai/status', async (_request, response) => {
  try {
    const status = await runPythonJson('check_environment.py', [], 15000);
    response.json({ status: { python: true, ...status } });
  } catch (error) {
    response.json({
      status: {
        python: false,
        ffmpeg: false,
        whisperx: false,
        mediapipe: false,
        pyannote: false,
        pyannoteToken: false,
        ollama: false,
      },
      detail: error.message,
    });
  }
});

app.get('/api/editorial/config', (_request, response) => {
  response.json({ config: editorialService.readConfig() });
});

app.put('/api/editorial/config', (request, response) => {
  response.json({ config: editorialService.saveConfig(request.body || {}) });
});

app.get('/api/editorial/status', async (_request, response) => {
  response.json({ status: await editorialService.getProviderStatus() });
});

app.get('/api/videos', (_request, response) => {
  const videos = readManifest().sort((first, second) =>
    second.createdAt.localeCompare(first.createdAt),
  );

  response.json({ videos });
});

app.get('/api/clips', (_request, response) => {
  const clips = readManifest()
    .flatMap((video) => video.clips || [])
    .sort((first, second) => second.createdAt.localeCompare(first.createdAt));

  response.json({ clips });
});

app.get('/api/projects', (_request, response) => {
  response.json({ projects: listProjects().map(getProjectSummary) });
});

app.post('/api/projects', (request, response) => {
  const { videoId, clipIds, title, layout, layoutOnly } = request.body || {};
  const { video } = getVideoById(videoId);

  if (!video) {
    response.status(404).json({ message: 'Video nao encontrado.' });
    return;
  }

  const requestedClipIds = Array.isArray(clipIds) ? clipIds : [];
  const availableClips = Array.isArray(video.clips) ? video.clips : [];
  const selectedClips = layoutOnly === true
    ? [{
        id: `layout-${crypto.randomUUID()}`,
        videoId: video.id,
        title: 'Layout base',
        sourceName: video.originalName,
        startSeconds: 0,
        endSeconds: Math.max(Number(video.durationSeconds || 1), 1),
        durationSeconds: Math.max(Number(video.durationSeconds || 1), 1),
      }]
    : requestedClipIds.length > 0
      ? availableClips.filter((clip) => requestedClipIds.includes(clip.id))
      : availableClips;

  if (layoutOnly !== true && Number(video.durationSeconds || 0) < MIN_CLIP_DURATION_SECONDS) {
    response.status(422).json({ message: 'O video precisa ter pelo menos 1 minuto para criar cortes.' });
    return;
  }

  if (layoutOnly !== true && selectedClips.some((clip) =>
    !hasMinimumDuration(clip.startSeconds, clip.endSeconds),
  )) {
    response.status(422).json({ message: 'Cada corte precisa ter pelo menos 1 minuto.' });
    return;
  }

  const project = createProject(video, selectedClips, layout);
  project.isLayoutDraft = layoutOnly === true;

  if (typeof title === 'string' && title.trim()) {
    project.title = title.trim();
  }

  writeProject(project);
  response.status(201).json({ project });
});

app.get('/api/projects/:id', (request, response) => {
  const project = readProject(request.params.id);

  if (!project) {
    response.status(404).json({ message: 'Projeto nao encontrado.' });
    return;
  }

  response.json({ project });
});

function getEditorialClip(video, composition) {
  const savedClip = video?.clips?.find((clip) => clip.id === composition.clipId);
  if (savedClip) {
    return savedClip;
  }

  const videoItem = composition?.tracks
    ?.find((track) => track.kind === 'video')
    ?.items?.[0];
  const startSeconds = Number(videoItem?.sourceInMs || 0) / 1000;
  const endSeconds = Number(videoItem?.sourceOutMs || composition.durationMs || 1000) / 1000;

  return {
    id: composition.clipId,
    title: composition.title,
    startSeconds,
    endSeconds: Math.max(endSeconds, startSeconds + 0.1),
  };
}

app.post('/api/projects/:id/editorial/analyze', async (request, response) => {
  try {
    const project = readProject(request.params.id);

    if (!project) {
      response.status(404).json({ message: 'Projeto nao encontrado.' });
      return;
    }

    const { video } = getVideoById(project.sourceVideoId);
    if (!video) {
      response.status(404).json({ message: 'Video de origem nao encontrado.' });
      return;
    }

    const transcriptSegments = video.analysis?.tools?.whisperx?.segments || [];
    const providerStatus = await editorialService.getProviderStatus();
    const analyzedAt = new Date().toISOString();
    const analyzedCompositions = [];

    // Analises sequenciais evitam sobrecarregar um modelo local com varias geracoes simultaneas.
    for (const composition of project.compositions || []) {
      const clip = getEditorialClip(video, composition);
      const analysis = await editorialService.analyzeClip({
        clip,
        transcriptSegments,
        providerStatus,
      });
      const currentEditorial = composition.editorial || {};
      const titleIsManual = currentEditorial.titleSource === 'manual';
      const descriptionIsManual = currentEditorial.descriptionSource === 'manual';
      const editorial = {
        version: 1,
        title: titleIsManual ? String(currentEditorial.title || composition.title) : analysis.suggestions.title,
        description: descriptionIsManual ? String(currentEditorial.description || '') : analysis.suggestions.description,
        titleSource: titleIsManual ? 'manual' : 'suggested',
        descriptionSource: descriptionIsManual ? 'manual' : 'suggested',
        score: analysis.score,
        source: analysis.source,
        ...(analysis.fallbackReason ? { fallbackReason: analysis.fallbackReason } : {}),
        status: currentEditorial.status === 'reviewed' ? 'reviewed' : 'draft',
        updatedAt: analyzedAt,
      };

      analyzedCompositions.push({
        ...composition,
        title: editorial.title,
        editorial,
        updatedAt: analyzedAt,
      });
    }

    const analyzedProject = {
      ...project,
      compositions: analyzedCompositions,
      updatedAt: analyzedAt,
    };

    writeProject(analyzedProject);
    response.json({ project: analyzedProject, providerStatus });
  } catch (error) {
    console.error(`[editorial] project analysis failed: ${error.message}`);
    response.status(500).json({ message: `Falha na analise editorial: ${error.message}` });
  }
});

app.patch('/api/projects/:id/compositions/:compositionId/editorial', (request, response) => {
  const project = readProject(request.params.id);

  if (!project) {
    response.status(404).json({ message: 'Projeto nao encontrado.' });
    return;
  }

  const composition = project.compositions?.find((item) => item.id === request.params.compositionId);
  if (!composition) {
    response.status(404).json({ message: 'Composicao nao encontrada.' });
    return;
  }

  const body = request.body || {};
  const hasTitle = typeof body.title === 'string';
  const hasDescription = typeof body.description === 'string';
  if (!hasTitle && !hasDescription) {
    response.status(400).json({ message: 'Informe titulo ou descricao para salvar.' });
    return;
  }

  const updatedAt = new Date().toISOString();
  const currentEditorial = composition.editorial || {};
  const title = hasTitle ? body.title.trim().slice(0, 100) : String(currentEditorial.title || composition.title);
  const description = hasDescription
    ? body.description.trim().slice(0, 1000)
    : String(currentEditorial.description || '');
  const updatedEditorial = {
    version: 1,
    title: title || composition.title,
    description,
    titleSource: hasTitle ? 'manual' : (currentEditorial.titleSource || 'suggested'),
    descriptionSource: hasDescription ? 'manual' : (currentEditorial.descriptionSource || 'suggested'),
    ...(currentEditorial.score ? { score: currentEditorial.score } : {}),
    status: 'reviewed',
    updatedAt,
  };
  const updatedProject = {
    ...project,
    compositions: project.compositions.map((currentComposition) => currentComposition.id === composition.id
      ? {
          ...currentComposition,
          title: updatedEditorial.title,
          editorial: updatedEditorial,
          updatedAt,
        }
      : currentComposition),
    updatedAt,
  };

  writeProject(updatedProject);
  response.json({ project: updatedProject });
});

function addSharedImageToProject(project, assetId) {
  const now = new Date().toISOString();
  return {
    ...project,
    compositions: (project.compositions || []).map((composition) => {
      const existingImage = composition.tracks
        ?.filter((track) => track.kind === 'media')
        .flatMap((track) => track.items || [])
        .find((item) => item.assetId === assetId);

      if (existingImage) {
        return composition;
      }

      const imageItem = {
        id: crypto.randomUUID(),
        assetId,
        sourceInMs: 0,
        sourceOutMs: Math.max(Number(composition.durationMs || 100), 100),
        timelineStartMs: 0,
        regionId: composition.layout?.regions?.[0]?.id || 'main',
        mediaType: 'image',
        transform: {
          x: 0,
          y: 0,
          scale: 0.35,
          cropMode: 'contain',
          rotation: 0,
        },
      };
      const mediaTrack = composition.tracks?.find((track) => track.kind === 'media');
      const tracks = mediaTrack
        ? composition.tracks.map((track) => track.id === mediaTrack.id
            ? { ...track, items: [...(track.items || []), imageItem] }
            : track)
        : [
            ...(composition.tracks || []),
            { id: crypto.randomUUID(), kind: 'media', items: [imageItem] },
          ];

      return {
        ...composition,
        tracks,
        review: composition.review
          ? { ...composition.review, status: 'pending', issues: [] }
          : composition.review,
        updatedAt: now,
      };
    }),
    updatedAt: now,
  };
}

function removeSharedImageFromProject(project, assetId) {
  const asset = (project.assets || []).find((currentAsset) =>
    currentAsset.id === assetId && currentAsset.type === 'image',
  );

  if (!asset) {
    return null;
  }

  const now = new Date().toISOString();
  const compositions = (project.compositions || []).map((composition) => {
    const tracks = (composition.tracks || [])
      .map((track) => track.kind === 'media'
        ? { ...track, items: (track.items || []).filter((item) => item.assetId !== assetId) }
        : track)
      .filter((track) => track.kind !== 'media' || track.items.length > 0);

    return {
      ...composition,
      tracks,
      review: composition.review
        ? { ...composition.review, status: 'pending', issues: [] }
        : composition.review,
      updatedAt: now,
    };
  });

  return {
    asset,
    project: {
      ...project,
      assets: (project.assets || []).filter((currentAsset) => currentAsset.id !== assetId),
      compositions,
      updatedAt: now,
    },
  };
}

app.post('/api/projects/:id/assets', imageUpload.single('image'), (request, response) => {
  const project = readProject(request.params.id);

  if (!project) {
    response.status(404).json({ message: 'Projeto nao encontrado.' });
    return;
  }

  if (!request.file) {
    response.status(400).json({ message: 'Nenhuma imagem foi enviada.' });
    return;
  }

  const asset = {
    id: crypto.randomUUID(),
    type: 'image',
    name: request.file.originalname,
    fileName: request.file.filename,
    url: `/project-assets/${request.file.filename}`,
  };
  let updatedProject = {
    ...project,
    assets: [...(project.assets || []), asset],
    updatedAt: new Date().toISOString(),
  };

  if (request.body?.addToLayout === 'true') {
    updatedProject = addSharedImageToProject(updatedProject, asset.id);
  }

  writeProject(updatedProject);
  response.status(201).json({ asset, project: updatedProject });
});

app.delete('/api/projects/:id/assets/:assetId', (request, response) => {
  const project = readProject(request.params.id);

  if (!project) {
    response.status(404).json({ message: 'Projeto nao encontrado.' });
    return;
  }

  const result = removeSharedImageFromProject(project, request.params.assetId);
  if (!result) {
    response.status(404).json({ message: 'Imagem nao encontrada.' });
    return;
  }

  writeProject(result.project);

  try {
    const assetPath = getSafeProjectAssetPath(result.asset.fileName);
    if (fs.existsSync(assetPath)) {
      fs.unlinkSync(assetPath);
    }
  } catch {
    // O projeto já foi atualizado; um arquivo ausente não impede a remoção lógica.
  }

  response.json({ project: result.project });
});

app.post('/api/projects/:id/generate-clips', async (request, response) => {
  const project = readProject(request.params.id);

  if (!project) {
    response.status(404).json({ message: 'Projeto nao encontrado.' });
    return;
  }

  if (!project.isLayoutDraft) {
    response.json({ project });
    return;
  }

  const { video } = getVideoById(project.sourceVideoId);
  if (!video) {
    response.status(404).json({ message: 'Video de origem nao encontrado.' });
    return;
  }

  let videoPath;
  try {
    videoPath = getSafeVideoPath(video.fileName);
  } catch {
    response.status(400).json({ message: 'Caminho de video invalido.' });
    return;
  }

  if (!fs.existsSync(videoPath)) {
    response.status(404).json({ message: 'Arquivo de video nao encontrado.' });
    return;
  }

  if (Number(video.durationSeconds || 0) < MIN_CLIP_DURATION_SECONDS) {
    response.status(422).json({ message: 'O video precisa ter pelo menos 1 minuto para gerar cortes.' });
    return;
  }

  const baseComposition = project.compositions?.[0];
  const layoutConfig = baseComposition
    ? {
        canvas: cloneJson(baseComposition.canvas),
        layout: cloneJson(baseComposition.layout),
      }
    : (project.layoutTemplate ? cloneJson(project.layoutTemplate) : null);
  const baseVideoItem = baseComposition?.tracks
    ?.find((track) => track.kind === 'video')
    ?.items?.[0];
  const mediaTracks = baseComposition?.tracks?.filter((track) => track.kind === 'media') || [];
  let preparedCaptionTrack = null;
  try {
    preparedCaptionTrack = await prepareCaptionTrack(videoPath, video, baseComposition?.captionSettings);
  } catch (error) {
    console.error(`[captions] preparation failed for project ${project.id}: ${error.message}`);
    response.status(422).json({ message: error.message });
    return;
  }
  const clips = buildSuggestedClips(video, request.body || {});
  if (!Array.isArray(clips) || clips.length === 0) {
    response.status(400).json({ message: 'Nao foi possivel gerar cortes de pelo menos 1 minuto para este video.' });
    return;
  }
  const generatedProject = createProject(video, clips, layoutConfig);
  const now = new Date().toISOString();
  const updatedProject = {
    ...generatedProject,
    id: project.id,
    title: project.title,
    sourceVideoId: project.sourceVideoId,
    sourceName: project.sourceName,
    assets: cloneJson(project.assets || generatedProject.assets),
    layoutTemplate: cloneJson(layoutConfig),
    isLayoutDraft: false,
    createdAt: project.createdAt,
    updatedAt: now,
    compositions: generatedProject.compositions.map((composition) => ({
      ...composition,
      projectId: project.id,
      captionSettings: cloneJson(baseComposition?.captionSettings || composition.captionSettings),
      ...(preparedCaptionTrack?.cues?.length || preparedCaptionTrack?.words?.length
        ? { captionTrack: sliceCaptionTrack(preparedCaptionTrack, clips.find((clip) => clip.id === composition.clipId) || composition) }
        : {}),
      tracks: [
        ...composition.tracks.map((track) => track.kind === 'video' && baseVideoItem
          ? {
              ...track,
              items: track.items.map((item) => ({
                ...item,
                regionId: baseVideoItem.regionId,
                transform: cloneJson(baseVideoItem.transform),
              })),
            }
          : track),
        ...cloneJson(mediaTracks).map((track) => ({
          ...track,
          items: (track.items || []).map((item) => ({
            ...item,
            sourceOutMs: Math.max(composition.durationMs, 100),
          })),
        })),
      ],
    })),
  };

  updateVideo(video.id, (currentVideo) => ({
    ...currentVideo,
    clips,
    clipsGeneratedAt: now,
  }));
  writeProject(updatedProject);
  response.status(201).json({
    project: updatedProject,
    maxClipCount: getMaxClipCount(video.durationSeconds),
  });
});

app.post('/api/projects/:id/analyze', (request, response) => {
  const project = readProject(request.params.id);

  if (!project) {
    response.status(404).json({ message: 'Projeto nao encontrado.' });
    return;
  }

  const reviewedAt = new Date().toISOString();
  const reviewedProject = {
    ...project,
    compositions: (project.compositions || []).map((composition) => ({
      ...composition,
      review: reviewComposition(composition),
    })),
    updatedAt: reviewedAt,
  };

  writeProject(reviewedProject);
  response.json({ project: reviewedProject });
});

app.post('/api/projects/:id/approve-ready', (request, response) => {
  const project = readProject(request.params.id);

  if (!project) {
    response.status(404).json({ message: 'Projeto nao encontrado.' });
    return;
  }

  const compositions = project.compositions || [];
  if (compositions.length === 0) {
    response.status(400).json({ message: 'O projeto nao possui cortes para aprovar.' });
    return;
  }

  const blockedComposition = compositions.find((composition) => composition.review?.status !== 'ready');
  if (blockedComposition) {
    response.status(409).json({
      message: 'Analise e ajuste todos os cortes antes de aprovar em lote.',
    });
    return;
  }

  const approvedAt = new Date().toISOString();
  let approvedCount = 0;
  const approvedCompositions = compositions.map((composition) => {
    if (composition.status === 'approved') {
      return composition;
    }

    approvedCount += 1;
    return {
      ...composition,
      status: 'approved',
      revision: composition.revision + 1,
      updatedAt: approvedAt,
    };
  });
  const approvedProject = {
    ...project,
    compositions: approvedCompositions,
    updatedAt: approvedAt,
  };

  writeProject(approvedProject);
  response.json({ project: approvedProject, approvedCount });
});

app.put('/api/compositions/:id', (request, response) => {
  const { project, composition: currentComposition } = findComposition(request.params.id);
  const incomingComposition = normalizeComposition(request.body?.composition || request.body);
  const expectedRevision = Number(request.body?.expectedRevision ?? incomingComposition?.revision);

  if (!project || !currentComposition) {
    response.status(404).json({ message: 'Composicao nao encontrada.' });
    return;
  }

  if (!isValidComposition(incomingComposition)) {
    response.status(400).json({ message: 'Composicao invalida.' });
    return;
  }

  if (!project.isLayoutDraft && !hasMinimumClipDuration(incomingComposition)) {
    response.status(422).json({ message: 'Cada corte precisa ter pelo menos 1 minuto.' });
    return;
  }

  if (expectedRevision !== currentComposition.revision) {
    response.status(409).json({
      message: 'A composicao foi alterada por outra gravacao.',
      composition: currentComposition,
    });
    return;
  }

  const reviewableFieldsChanged = JSON.stringify({
    canvas: incomingComposition.canvas,
    tracks: incomingComposition.tracks,
    layout: incomingComposition.layout,
    captionSettings: incomingComposition.captionSettings,
  }) !== JSON.stringify({
    canvas: currentComposition.canvas,
    tracks: currentComposition.tracks,
    layout: currentComposition.layout,
    captionSettings: currentComposition.captionSettings,
  });
  const captionSettingsChanged = getCaptionContentFingerprint(incomingComposition.captionSettings) !== getCaptionContentFingerprint(currentComposition.captionSettings);
  const normalizedCaptionSettings = normalizeCaptionSettings(incomingComposition.captionSettings);
  const savedComposition = {
    ...incomingComposition,
    id: currentComposition.id,
    projectId: project.id,
    captionSettings: normalizedCaptionSettings,
    captionTrack: captionSettingsChanged
      ? undefined
      : incomingComposition.captionTrack || currentComposition.captionTrack,
    review: reviewableFieldsChanged
      ? { status: 'pending', issues: [] }
      : incomingComposition.review || currentComposition.review,
    revision: currentComposition.revision + 1,
    updatedAt: new Date().toISOString(),
  };
  const sharedMediaTracks = savedComposition.tracks.filter((track) => track.kind === 'media');
  const sharedLayoutChanged = JSON.stringify({
    canvas: savedComposition.canvas,
    layout: savedComposition.layout,
    mediaTracks: sharedMediaTracks,
  }) !== JSON.stringify({
    canvas: currentComposition.canvas,
    layout: currentComposition.layout,
    mediaTracks: currentComposition.tracks.filter((track) => track.kind === 'media'),
  });
  const updatedProject = {
    ...project,
    layoutTemplate: {
      canvas: cloneJson(savedComposition.canvas),
      layout: cloneJson(savedComposition.layout),
    },
    compositions: project.compositions.map((composition) => {
      if (composition.id === currentComposition.id) {
        return savedComposition;
      }

      return {
        ...composition,
        canvas: cloneJson(savedComposition.canvas),
        layout: cloneJson(savedComposition.layout),
        review: sharedLayoutChanged ? { status: 'pending', issues: [] } : composition.review,
        tracks: [
          ...(composition.tracks || []).filter((track) => track.kind !== 'media'),
          ...cloneJson(sharedMediaTracks),
        ],
      };
    }),
    updatedAt: savedComposition.updatedAt,
  };

  writeProject(updatedProject);
  response.json({ composition: savedComposition, project: updatedProject });
});

app.post('/api/compositions/:id/approve', (request, response) => {
  const { project, composition: currentComposition } = findComposition(request.params.id);

  if (!project || !currentComposition) {
    response.status(404).json({ message: 'Composicao nao encontrada.' });
    return;
  }

  const expectedRevision = Number(request.body?.expectedRevision ?? currentComposition.revision);
  if (expectedRevision !== currentComposition.revision) {
    response.status(409).json({
      message: 'A composicao foi alterada por outra gravacao.',
      composition: currentComposition,
    });
    return;
  }

  const approvedComposition = {
    ...currentComposition,
    status: 'approved',
    revision: currentComposition.revision + 1,
    updatedAt: new Date().toISOString(),
  };
  const updatedProject = {
    ...project,
    compositions: project.compositions.map((composition) =>
      composition.id === currentComposition.id ? approvedComposition : composition,
    ),
    updatedAt: approvedComposition.updatedAt,
  };

  writeProject(updatedProject);
  response.json({ composition: approvedComposition, project: updatedProject });
});

app.post('/api/compositions/:id/duplicate', (request, response) => {
  const { project, composition: currentComposition } = findComposition(request.params.id);

  if (!project || !currentComposition) {
    response.status(404).json({ message: 'Composicao nao encontrada.' });
    return;
  }

  const duplicatedComposition = {
    ...JSON.parse(JSON.stringify(currentComposition)),
    id: crypto.randomUUID(),
    title: `${currentComposition.title} - variacao`,
    status: 'editing',
    revision: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const updatedProject = {
    ...project,
    compositions: [...project.compositions, duplicatedComposition],
    updatedAt: duplicatedComposition.updatedAt,
  };

  writeProject(updatedProject);
  response.status(201).json({ composition: duplicatedComposition, project: updatedProject });
});

app.post('/api/videos/:id/clips', (request, response) => {
  const { video } = getVideoById(request.params.id);

  if (!video) {
    response.status(404).json({ message: 'Video nao encontrado.' });
    return;
  }

  if (Number(video.durationSeconds || 0) < MIN_CLIP_DURATION_SECONDS) {
    response.status(422).json({ message: 'O video precisa ter pelo menos 1 minuto para gerar cortes.' });
    return;
  }

  const clips = buildSuggestedClips(video, request.body || {});
  const updatedVideo = updateVideo(video.id, (currentVideo) => ({
    ...currentVideo,
    clips,
    clipsGeneratedAt: new Date().toISOString(),
  }));

  response.status(201).json({
    video: updatedVideo,
    clips,
    maxClipCount: getMaxClipCount(video.durationSeconds),
  });
});

const EXPORT_JOB_PHASES = ['preflight', 'captions', 'render', 'validate', 'cleanup'];
let activeExportJobs = 0;

function createExportJobError(code, message, clipId = null) {
  const error = new Error(message);
  error.code = code;
  error.clipId = clipId;
  return error;
}

function normalizeExportOptions(input = {}) {
  const subtitleMode = ['automatic', 'manual', 'none'].includes(input.subtitleMode)
    ? input.subtitleMode
    : 'automatic';
  const subtitleDisplayMode = ['block', 'word'].includes(input.subtitleDisplayMode)
    ? input.subtitleDisplayMode
    : 'block';
  const subtitleLanguage = ['original', 'pt-BR'].includes(input.subtitleLanguage)
    ? input.subtitleLanguage
    : 'pt-BR';

  return {
    subtitleMode,
    manualSubtitleText: String(input.manualSubtitleText || ''),
    subtitleCorrections: parseSubtitleCorrections(input.subtitleCorrections),
    subtitleFont: String(input.subtitleFont || 'inter'),
    subtitlePosition: ['bottom', 'middle', 'top'].includes(input.subtitlePosition)
      ? input.subtitlePosition
      : 'bottom',
    subtitleDisplayMode,
    subtitleLanguage,
    audioMode: String(input.audioMode || 'Audio original'),
  };
}

function getExportJobWorkspace(job) {
  try {
    return getSafeGalleryPath(job.folderName);
  } catch {
    throw createExportJobError('INVALID_GALLERY_PATH', 'Caminho de galeria invalido.');
  }
}

function cleanupExportJobWorkspace(job, removeAll = false) {
  let workspacePath;
  try {
    workspacePath = getExportJobWorkspace(job);
  } catch {
    return;
  }

  if (!fs.existsSync(workspacePath)) {
    return;
  }

  if (removeAll) {
    fs.rmSync(workspacePath, { recursive: true, force: true });
    return;
  }

  const entries = fs.readdirSync(workspacePath, { withFileTypes: true });
  entries.forEach((entry) => {
    if (!entry.isFile() || (!entry.name.endsWith('.tmp') && !entry.name.endsWith('.part'))) {
      return;
    }

    fs.rmSync(path.join(workspacePath, entry.name), { force: true });
  });
}

function createExportJob({ video, project, selectedClips, selectedCompositions, options }) {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const packageId = crypto.randomUUID();
  const clipSnapshots = cloneJson(selectedClips);
  const compositionSnapshots = cloneJson(selectedCompositions);

  return {
    version: 1,
    id,
    status: 'queued',
    phase: 'preflight',
    progress: 0,
    videoId: video.id,
    sourceName: video.originalName,
    projectId: project?.id || null,
    clipIds: clipSnapshots.map((clip) => clip.id),
    compositionIds: compositionSnapshots.map((composition) => composition.id),
    inputRevision: Math.max(0, ...compositionSnapshots.map((composition) => Number(composition.revision) || 0)),
    packageId,
    folderName: `${Date.now()}-${packageId}`,
    options,
    clipSnapshots,
    compositionSnapshots,
    clipResults: clipSnapshots.map((clip) => ({
      clipId: clip.id,
      title: clip.title,
      status: 'queued',
      phase: 'preflight',
      progress: 0,
      attempts: 0,
      errorCode: null,
      error: null,
    })),
    outputPaths: [],
    retryCount: 0,
    cancelRequested: false,
    currentClipId: null,
    errorCode: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  };
}

function calculateExportProgress(index, total, phase, phaseProgress = 0) {
  const safeTotal = Math.max(total, 1);
  const clipWidth = 90 / safeTotal;
  const phaseStart = {
    captions: 0,
    render: 0.25,
    validate: 0.9,
  }[phase] ?? 0;
  const phaseWidth = {
    captions: 0.25,
    render: 0.65,
    validate: 0.1,
  }[phase] ?? 0;
  const normalizedProgress = Math.min(1, Math.max(0, Number(phaseProgress) || 0));
  return Math.min(95, Math.round(5 + (index * clipWidth) + (clipWidth * (phaseStart + phaseWidth * normalizedProgress))));
}

function assertExportJobActive(jobId) {
  const job = getExportJob(jobId);
  if (!job || job.cancelRequested || job.status === 'cancelled') {
    throw createExportJobError('JOB_CANCELLED', 'Exportacao cancelada.');
  }

  return job;
}

function buildGalleryClip(job, clipResult) {
  const clip = job.clipSnapshots.find((currentClip) => currentClip.id === clipResult.clipId) || {};
  return {
    ...clip,
    status: 'Pronto',
    shouldCaption: Boolean(clipResult.shouldCaption),
    subtitleMode: clipResult.subtitleMode,
    subtitleFont: clipResult.subtitleFont,
    subtitlePosition: clipResult.subtitlePosition,
    subtitleDisplayMode: clipResult.subtitleDisplayMode,
    subtitleLanguage: clipResult.subtitleLanguage,
    subtitlePath: clipResult.subtitlePath || null,
    subtitleError: clipResult.subtitleError || null,
    subtitleSource: clipResult.subtitleSource || null,
    subtitleCorrections: clipResult.subtitleCorrections || 0,
    audioMode: clipResult.audioMode,
    exportResult: clipResult.exportResult,
    fileName: clipResult.fileName,
    url: clipResult.url,
  };
}

function buildGalleryPackage(job) {
  const successfulClips = job.clipResults
    .filter((clipResult) => clipResult.status === 'succeeded')
    .map((clipResult) => buildGalleryClip(job, clipResult));
  const options = job.options;

  return {
    id: job.packageId,
    jobId: job.id,
    title: `Pacote - ${job.sourceName}`,
    folderName: job.folderName,
    folderUrl: `/gallery/${job.folderName}`,
    sourceVideoId: job.videoId,
    sourceName: job.sourceName,
    projectId: job.projectId,
    compositionIds: job.compositionIds,
    canvas: job.compositionSnapshots[0]?.canvas || null,
    createdAt: new Date().toISOString(),
    subtitleMode: options.subtitleMode,
    subtitleFont: options.subtitleFont,
    subtitlePosition: options.subtitlePosition,
    subtitleDisplayMode: options.subtitleDisplayMode,
    subtitleLanguage: options.subtitleLanguage,
    subtitleCorrections: options.subtitleCorrections.length,
    audioMode: options.audioMode,
    clips: successfulClips,
  };
}

function upsertGalleryPackage(galleryPackage) {
  const packages = readGalleryManifest();
  const existingIndex = packages.findIndex((item) => item.id === galleryPackage.id);
  if (existingIndex === -1) {
    packages.push(galleryPackage);
  } else {
    packages[existingIndex] = galleryPackage;
  }
  writeGalleryManifest(packages);
}

async function processExportJob(startedJob) {
  let activeClipId = null;
  let activePhase = 'preflight';

  try {
    let job = assertExportJobActive(startedJob.id);
    const { video } = getVideoById(job.videoId);
    if (!video) {
      throw createExportJobError('VIDEO_NOT_FOUND', 'Video nao encontrado.');
    }

    let videoPath;
    try {
      videoPath = getSafeVideoPath(video.fileName);
    } catch {
      throw createExportJobError('INVALID_VIDEO_PATH', 'Caminho de video invalido.');
    }

    if (!fs.existsSync(videoPath)) {
      throw createExportJobError('VIDEO_FILE_NOT_FOUND', 'Arquivo de video nao encontrado.');
    }

    const packagePath = getExportJobWorkspace(job);
    fs.mkdirSync(packagePath, { recursive: true });
    const extension = path.extname(video.fileName) || '.mp4';
    const compositionByClip = new Map(job.compositionSnapshots.map((composition) => [composition.clipId, composition]));
    const totalClips = job.clipSnapshots.length;

    updateExportJob(job.id, (currentJob) => ({
      ...currentJob,
      phase: 'preflight',
      progress: 3,
      clipResults: currentJob.clipResults.map((clipResult) => {
        if (clipResult.status !== 'succeeded' || !clipResult.fileName) {
          return clipResult;
        }

        return fs.existsSync(path.join(packagePath, clipResult.fileName))
          ? clipResult
          : {
              ...clipResult,
              status: 'queued',
              phase: 'preflight',
              progress: 0,
              errorCode: null,
              error: null,
            };
      }),
      updatedAt: new Date().toISOString(),
    }));
    job = assertExportJobActive(job.id);

    if (!Array.isArray(job.clipSnapshots) || job.clipSnapshots.length === 0) {
      throw createExportJobError('EMPTY_EXPORT', 'Nenhum clipe selecionado para exportar.');
    }

    const options = job.options;
    const fontName = getSubtitleFontName(options.subtitleFont);
    const needsTranscript = options.subtitleMode === 'automatic' && job.clipSnapshots.some((clip) => {
      const captionTrack = compositionByClip.get(clip.id)?.captionTrack;
      return !captionTrack?.cues?.length && !captionTrack?.words?.length;
    });
    let fullVideoTranscript = null;

    if (needsTranscript) {
      activePhase = 'captions';
      assertExportJobActive(job.id);
      updateExportJob(job.id, (currentJob) => ({
        ...currentJob,
        phase: 'captions',
        progress: 5,
        updatedAt: new Date().toISOString(),
      }));
      fullVideoTranscript = await getFullVideoTranscript(videoPath, video);
      if (!fullVideoTranscript?.ok) {
        throw createExportJobError(
          'CAPTIONS_FAILED',
          fullVideoTranscript?.error || 'Transcricao automatica indisponivel.',
        );
      }
      assertExportJobActive(job.id);
    }

    for (const [index, clip] of job.clipSnapshots.entries()) {
      job = assertExportJobActive(job.id);
      const currentResult = job.clipResults.find((clipResult) => clipResult.clipId === clip.id);
      if (!currentResult || currentResult.status !== 'queued') {
        continue;
      }

      activeClipId = clip.id;
      const composition = compositionByClip.get(clip.id) || null;
      const clipBaseName = sanitizeFileName(`${index + 1}-${clip.title}`) || `clip-${index + 1}`;
      const exportedFileName = `${clipBaseName}${extension}`;
      const exportedPath = path.join(packagePath, exportedFileName);
      const subtitleCanvas = composition?.canvas || { width: 1080, height: 1920 };
      const nextAttempt = Number(currentResult.attempts || 0) + 1;

      activePhase = 'captions';
      updateExportJob(job.id, (currentJob) => ({
        ...currentJob,
        phase: 'captions',
        progress: calculateExportProgress(index, totalClips, 'captions', 0),
        currentClipId: clip.id,
        clipResults: currentJob.clipResults.map((result) => result.clipId === clip.id
          ? {
              ...result,
              status: 'running',
              phase: 'captions',
              progress: 0,
              attempts: nextAttempt,
              errorCode: null,
              error: null,
            }
          : result),
        updatedAt: new Date().toISOString(),
      }));

      const subtitleFile = options.subtitleMode === 'automatic'
        ? await createAutomaticSubtitleFile(
            packagePath,
            job.folderName,
            clipBaseName,
            fullVideoTranscript,
            clip,
            options.subtitleCorrections,
            {
              displayMode: options.subtitleDisplayMode,
              fontName,
              position: options.subtitlePosition,
              canvasWidth: subtitleCanvas.width,
              canvasHeight: subtitleCanvas.height,
              subtitleLanguage: options.subtitleLanguage,
              captionTrack: composition?.captionTrack,
              captionSettings: composition?.captionSettings,
            },
          )
        : await createSubtitleFile(packagePath, job.folderName, clipBaseName, video, clip, {
            subtitleMode: options.subtitleMode,
            manualSubtitleText: options.manualSubtitleText,
            subtitleCorrections: options.subtitleCorrections,
            subtitleDisplayMode: options.subtitleDisplayMode,
            subtitleFontName: fontName,
            subtitlePosition: options.subtitlePosition,
            canvasWidth: subtitleCanvas.width,
            canvasHeight: subtitleCanvas.height,
            subtitleLanguage: options.subtitleLanguage,
            captionTrack: composition?.captionTrack,
            captionSettings: composition?.captionSettings,
          });

      assertExportJobActive(job.id);
      if (subtitleFile?.error) {
        throw createExportJobError('CAPTIONS_FAILED', subtitleFile.error, clip.id);
      }

      activePhase = 'render';
      updateExportJob(job.id, (currentJob) => ({
        ...currentJob,
        phase: 'render',
        progress: calculateExportProgress(index, totalClips, 'render', 0),
        clipResults: currentJob.clipResults.map((result) => result.clipId === clip.id
          ? { ...result, phase: 'render', progress: 0 }
          : result),
        updatedAt: new Date().toISOString(),
      }));

      const exportResult = await exportClipWithFfmpeg(
        videoPath,
        exportedPath,
        clip,
        subtitleFile?.filePath
          ? {
              subtitlePath: subtitleFile.filePath,
              fontName,
              position: options.subtitlePosition,
              captionSettings: composition?.captionSettings,
            }
          : null,
        composition,
        job.projectId ? readProject(job.projectId) : null,
        () => {
          const currentJob = getExportJob(job.id);
          return !currentJob || currentJob.cancelRequested || currentJob.status === 'cancelled';
        },
      );

      if (exportResult.cancelled) {
        throw createExportJobError('JOB_CANCELLED', 'Exportacao cancelada.', clip.id);
      }
      if (!exportResult.ok) {
        throw createExportJobError('RENDER_FAILED', exportResult.message || 'Falha ao recortar com ffmpeg.', clip.id);
      }

      activePhase = 'validate';
      const outputStats = fs.existsSync(exportedPath) ? fs.statSync(exportedPath) : null;
      if (!outputStats || outputStats.size === 0) {
        throw createExportJobError('OUTPUT_INVALID', 'O arquivo exportado nao foi validado.', clip.id);
      }

      updateExportJob(job.id, (currentJob) => ({
        ...currentJob,
        phase: 'validate',
        progress: calculateExportProgress(index, totalClips, 'validate', 1),
        currentClipId: null,
        outputPaths: [...new Set([...(currentJob.outputPaths || []), path.relative(ROOT_DIR, exportedPath)])],
        clipResults: currentJob.clipResults.map((result) => result.clipId === clip.id
          ? {
              ...result,
              status: 'succeeded',
              phase: 'validate',
              progress: 100,
              outputPath: path.relative(ROOT_DIR, exportedPath),
              fileName: exportedFileName,
              url: `/gallery/${job.folderName}/${exportedFileName}`,
              shouldCaption: Boolean(subtitleFile?.filePath),
              subtitleMode: options.subtitleMode,
              subtitleFont: options.subtitleFont,
              subtitlePosition: options.subtitlePosition,
              subtitleDisplayMode: options.subtitleDisplayMode,
              subtitleLanguage: options.subtitleLanguage,
              subtitlePath: subtitleFile?.url || null,
              subtitleError: subtitleFile?.error || null,
              subtitleSource: composition?.captionTrack ? 'composition-caption-track' : fullVideoTranscript?.source || null,
              subtitleCorrections: options.subtitleCorrections.length,
              audioMode: options.audioMode,
              exportResult,
              errorCode: null,
              error: null,
            }
          : result),
        updatedAt: new Date().toISOString(),
      }));
      activeClipId = null;
      job = assertExportJobActive(job.id);
    }

    job = assertExportJobActive(job.id);
    const unfinishedResults = job.clipResults.filter((clipResult) => clipResult.status !== 'succeeded');
    if (unfinishedResults.length > 0) {
      throw createExportJobError(
        'RETRY_REQUIRED',
        `${unfinishedResults.length} corte(s) ainda precisam de retry.`,
      );
    }

    activePhase = 'cleanup';
    updateExportJob(job.id, (currentJob) => ({
      ...currentJob,
      phase: 'cleanup',
      progress: 97,
      currentClipId: null,
      updatedAt: new Date().toISOString(),
    }));
    cleanupExportJobWorkspace(job);
    const finalJob = getExportJob(job.id);
    const galleryPackage = buildGalleryPackage(finalJob);
    writeJsonFile(path.join(packagePath, 'package.json'), galleryPackage);
    upsertGalleryPackage(galleryPackage);
    updateExportJob(job.id, (currentJob) => ({
      ...currentJob,
      status: 'succeeded',
      phase: 'cleanup',
      progress: 100,
      galleryPackageId: galleryPackage.id,
      finishedAt: new Date().toISOString(),
      currentClipId: null,
      errorCode: null,
      error: null,
      updatedAt: new Date().toISOString(),
    }));
  } catch (error) {
    const job = getExportJob(startedJob.id);
    if (!job) {
      return;
    }

    const isCancelled = error.code === 'JOB_CANCELLED' || job.cancelRequested || job.status === 'cancelled';
    if (isCancelled) {
      cleanupExportJobWorkspace(job, true);
      updateExportJob(job.id, (currentJob) => ({
        ...currentJob,
        status: 'cancelled',
        phase: 'cleanup',
        progress: Math.min(99, currentJob.progress || 0),
        cancelRequested: false,
        finishedAt: new Date().toISOString(),
        currentClipId: null,
        errorCode: 'CANCELLED',
        error: 'Exportacao cancelada.',
        clipResults: currentJob.clipResults.map((clipResult) => ({
          ...clipResult,
          status: 'cancelled',
          phase: 'cleanup',
          errorCode: 'CANCELLED',
          error: 'Exportacao cancelada.',
        })),
        updatedAt: new Date().toISOString(),
      }));
      return;
    }

    cleanupExportJobWorkspace(job);
    updateExportJob(job.id, (currentJob) => ({
      ...currentJob,
      status: 'failed',
      phase: EXPORT_JOB_PHASES.includes(activePhase) ? activePhase : 'validate',
      finishedAt: new Date().toISOString(),
      currentClipId: null,
      errorCode: error.code || 'EXPORT_FAILED',
      error: error.message || 'Falha ao exportar o pacote.',
      clipResults: currentJob.clipResults.map((clipResult) => clipResult.clipId === (error.clipId || activeClipId) && clipResult.status === 'running'
        ? {
            ...clipResult,
            status: 'failed',
            phase: activePhase,
            progress: 0,
            errorCode: error.code || 'EXPORT_FAILED',
            error: error.message || 'Falha ao exportar este corte.',
          }
        : clipResult),
      updatedAt: new Date().toISOString(),
    }));
    console.error(`[export-job] ${job.id} failed: ${error.message}`);
  }
}

function scheduleExportJobs() {
  while (activeExportJobs < EXPORT_JOB_CONCURRENCY) {
    const queuedJob = readExportJobs().find((job) => job.status === 'queued' && !job.cancelRequested);
    if (!queuedJob) {
      return;
    }

    const startedJob = updateExportJob(queuedJob.id, (currentJob) => currentJob.status === 'queued'
      ? {
          ...currentJob,
          status: 'running',
          phase: 'preflight',
          startedAt: currentJob.startedAt || new Date().toISOString(),
          finishedAt: null,
          updatedAt: new Date().toISOString(),
        }
      : currentJob);
    if (!startedJob || startedJob.status !== 'running') {
      continue;
    }

    activeExportJobs += 1;
    void processExportJob(startedJob).finally(() => {
      activeExportJobs = Math.max(0, activeExportJobs - 1);
      scheduleExportJobs();
    });
  }
}

function recoverExportJobs() {
  const jobs = readExportJobs();
  let changed = false;
  const recoveredJobs = jobs.map((job) => {
    if (job.status !== 'running') {
      return job;
    }

    changed = true;
    return {
      ...job,
      status: 'queued',
      phase: 'preflight',
      progress: 0,
      cancelRequested: false,
      finishedAt: null,
      currentClipId: null,
      clipResults: (job.clipResults || []).map((clipResult) => clipResult.status === 'running'
        ? { ...clipResult, status: 'queued', phase: 'preflight', progress: 0 }
        : clipResult),
      updatedAt: new Date().toISOString(),
    };
  });

  if (changed) {
    writeExportJobs(recoveredJobs);
  }
}

app.get('/api/export-jobs', (_request, response) => {
  const jobs = readExportJobs()
    .sort((first, second) => String(second.createdAt || '').localeCompare(String(first.createdAt || '')))
    .slice(0, 50)
    .map(publicExportJob);
  response.json({ jobs });
});

app.get('/api/export-jobs/:id', (request, response) => {
  const job = getExportJob(request.params.id);
  if (!job) {
    response.status(404).json({ message: 'Job de exportacao nao encontrado.' });
    return;
  }
  response.json({ job: publicExportJob(job) });
});

app.post('/api/export-jobs/:id/cancel', (request, response) => {
  const job = getExportJob(request.params.id);
  if (!job) {
    response.status(404).json({ message: 'Job de exportacao nao encontrado.' });
    return;
  }

  if (['succeeded', 'failed', 'cancelled'].includes(job.status)) {
    response.status(409).json({ message: 'Este job nao pode mais ser cancelado.' });
    return;
  }

  if (job.status === 'queued') {
    cleanupExportJobWorkspace(job, true);
    const cancelledJob = updateExportJob(job.id, (currentJob) => ({
      ...currentJob,
      status: 'cancelled',
      phase: 'cleanup',
      cancelRequested: false,
      finishedAt: new Date().toISOString(),
      errorCode: 'CANCELLED',
      error: 'Exportacao cancelada.',
      clipResults: currentJob.clipResults.map((clipResult) => ({
        ...clipResult,
        status: 'cancelled',
        phase: 'cleanup',
        errorCode: 'CANCELLED',
        error: 'Exportacao cancelada.',
      })),
      updatedAt: new Date().toISOString(),
    }));
    response.json({ job: publicExportJob(cancelledJob) });
    return;
  }

  const requestedJob = updateExportJob(job.id, (currentJob) => ({
    ...currentJob,
    cancelRequested: true,
    error: 'Cancelamento solicitado.',
    updatedAt: new Date().toISOString(),
  }));
  response.json({ job: publicExportJob(requestedJob) });
});

app.post('/api/export-jobs/:id/retry', (request, response) => {
  const job = getExportJob(request.params.id);
  if (!job) {
    response.status(404).json({ message: 'Job de exportacao nao encontrado.' });
    return;
  }

  if (!['failed', 'cancelled'].includes(job.status)) {
    response.status(409).json({ message: 'Somente jobs falhos ou cancelados podem ser repetidos.' });
    return;
  }

  const requestedClipId = typeof request.body?.clipId === 'string' ? request.body.clipId : '';
  if (requestedClipId) {
    const requestedResult = job.clipResults.find((clipResult) => clipResult.clipId === requestedClipId);
    if (!requestedResult || !['failed', 'cancelled'].includes(requestedResult.status)) {
      response.status(409).json({ message: 'Somente um corte falho pode ser repetido individualmente.' });
      return;
    }
  }

  const failedIds = job.status === 'cancelled'
    ? job.clipResults.map((clipResult) => clipResult.clipId)
    : job.clipResults
        .filter((clipResult) => ['failed', 'queued', 'cancelled'].includes(clipResult.status))
        .map((clipResult) => clipResult.clipId);
  const targetIds = requestedClipId ? [requestedClipId] : failedIds;
  const retriedJob = updateExportJob(job.id, (currentJob) => ({
    ...currentJob,
    status: 'queued',
    phase: 'preflight',
    progress: 0,
    cancelRequested: false,
    startedAt: null,
    finishedAt: null,
    currentClipId: null,
    retryCount: Number(currentJob.retryCount || 0) + 1,
    errorCode: null,
    error: null,
    clipResults: currentJob.clipResults.map((clipResult) => targetIds.includes(clipResult.clipId)
      ? {
          ...clipResult,
          status: 'queued',
          phase: 'preflight',
          progress: 0,
          errorCode: null,
          error: null,
        }
      : clipResult),
    updatedAt: new Date().toISOString(),
  }));
  scheduleExportJobs();
  response.status(202).json({ job: publicExportJob(retriedJob) });
});

app.get('/api/gallery', (_request, response) => {
  const packages = readGalleryManifest().sort((first, second) =>
    second.createdAt.localeCompare(first.createdAt),
  );

  response.json({ packages });
});

app.post('/api/gallery/export', (request, response) => {
  const {
    videoId,
    projectId,
    clipIds,
    compositionIds,
  } = request.body || {};
  const { video } = getVideoById(videoId);

  if (!video) {
    response.status(404).json({ message: 'Video nao encontrado.' });
    return;
  }

  const project = projectId ? readProject(projectId) : null;
  if (projectId && !project) {
    response.status(404).json({ message: 'Projeto nao encontrado.' });
    return;
  }

  let videoPath;
  try {
    videoPath = getSafeVideoPath(video.fileName);
  } catch {
    response.status(400).json({ message: 'Caminho de video invalido.' });
    return;
  }

  if (!fs.existsSync(videoPath)) {
    response.status(404).json({ message: 'Arquivo de video nao encontrado.' });
    return;
  }

  const requestedClipIds = Array.isArray(clipIds) ? clipIds : [];
  const sourceClips = video.clips || [];
  const selectedClips = requestedClipIds.length > 0
    ? sourceClips.filter((clip) => requestedClipIds.includes(clip.id))
    : sourceClips;

  if (selectedClips.length === 0) {
    response.status(400).json({ message: 'Nenhum clipe selecionado para exportar.' });
    return;
  }

  if (selectedClips.some((clip) =>
    !hasMinimumDuration(clip.startSeconds, clip.endSeconds),
  )) {
    response.status(422).json({ message: 'Todos os cortes precisam ter pelo menos 1 minuto para exportar.' });
    return;
  }

  const selectedCompositions = project
    ? (Array.isArray(compositionIds) && compositionIds.length > 0
        ? project.compositions.filter((composition) => compositionIds.includes(composition.id))
        : project.compositions.filter((composition) => selectedClips.some((clip) => clip.id === composition.clipId)))
    : [];

  if (project) {
    const compositionByClip = new Map(selectedCompositions.map((composition) => [composition.clipId, composition]));
    const blockedComposition = selectedClips.find((clip) => {
      const composition = compositionByClip.get(clip.id);
      return !composition || composition.status !== 'approved' || composition.review?.status !== 'ready';
    });

    if (blockedComposition) {
      response.status(409).json({
        message: 'Revise e aprove todos os cortes selecionados antes de exportar.',
      });
      return;
    }
  }

  const job = createExportJob({
    video,
    project,
    selectedClips,
    selectedCompositions,
    options: normalizeExportOptions(request.body || {}),
  });
  writeExportJobs([...readExportJobs(), job]);
  scheduleExportJobs();
  response.status(202).json({ job: publicExportJob(job) });
});

app.post('/api/videos/import-url', async (request, response) => {
  try {
    const video = await importVideoFromUrl(request.body?.url);
    response.status(201).json({ video });
  } catch (error) {
    const statusCode = error?.code === 'YTDLP_MISSING' ? 503 : 422;
    response.status(statusCode).json({ message: error?.message || 'Nao foi possivel importar o video pelo link.' });
  }
});

app.post('/api/videos', upload.single('video'), (request, response) => {
  if (!request.file) {
    response.status(400).json({ message: 'Nenhum video foi enviado.' });
    return;
  }

  const durationSeconds = Number(request.body.durationSeconds || 0);
  if (!Number.isFinite(durationSeconds) || durationSeconds < MIN_CLIP_DURATION_SECONDS || durationSeconds > MAX_VIDEO_DURATION_SECONDS) {
    fs.unlinkSync(request.file.path);
    response.status(422).json({ message: 'O video precisa ter duracao entre 1 minuto e 1 hora.' });
    return;
  }

  const videos = readManifest();
  const video = {
    id: crypto.randomUUID(),
    originalName: request.file.originalname,
    fileName: request.file.filename,
    type: request.file.mimetype,
    size: request.file.size,
    durationSeconds,
    createdAt: new Date().toISOString(),
    url: `/videos/${request.file.filename}`,
    sourceType: 'file',
    aiStatus: 'pending',
    analysis: null,
  };

  videos.push(video);
  writeManifest(videos);

  response.status(201).json({ video });
});

app.post('/api/videos/:id/analyze', async (request, response) => {
  const { video } = getVideoById(request.params.id);

  if (!video) {
    response.status(404).json({ message: 'Video nao encontrado.' });
    return;
  }

  let videoPath;

  try {
    videoPath = getSafeVideoPath(video.fileName);
  } catch {
    response.status(400).json({ message: 'Caminho de video invalido.' });
    return;
  }

  if (!fs.existsSync(videoPath)) {
    response.status(404).json({ message: 'Arquivo de video nao encontrado.' });
    return;
  }

  const analysisPath = path.join(VIDEOS_DIR, `${video.fileName}.analysis.json`);

  updateVideo(video.id, (currentVideo) => ({
    ...currentVideo,
    aiStatus: 'processing',
    analysisError: null,
  }));

  try {
    const analysis = await runPythonJson(
      'process_video.py',
      ['--video', videoPath, '--output', analysisPath],
      20 * 60 * 1000,
    );
    const updatedVideo = updateVideo(video.id, (currentVideo) => ({
      ...currentVideo,
      aiStatus: 'done',
      analysis,
      analysisPath: path.basename(analysisPath),
      analyzedAt: new Date().toISOString(),
    }));

    response.json({ video: updatedVideo });
  } catch (error) {
    const updatedVideo = updateVideo(video.id, (currentVideo) => ({
      ...currentVideo,
      aiStatus: 'error',
      analysisError: error.message,
    }));

    response.status(500).json({ message: 'Falha ao processar IA.', video: updatedVideo });
  }
});

app.delete('/api/videos/:id', (request, response) => {
  const videos = readManifest();
  const video = videos.find((item) => item.id === request.params.id);

  if (!video) {
    response.status(404).json({ message: 'Video nao encontrado.' });
    return;
  }

  let resolvedVideoPath;

  try {
    resolvedVideoPath = getSafeVideoPath(video.fileName);
  } catch {
    response.status(400).json({ message: 'Caminho de video invalido.' });
    return;
  }

  if (fs.existsSync(resolvedVideoPath)) {
    fs.unlinkSync(resolvedVideoPath);
  }

  const analysisPath = path.join(VIDEOS_DIR, `${video.fileName}.analysis.json`);

  if (fs.existsSync(analysisPath)) {
    fs.unlinkSync(analysisPath);
  }

  writeManifest(videos.filter((item) => item.id !== video.id));
  response.status(204).send();
});

app.use((error, _request, response, _next) => {
  if (error.message === 'INVALID_VIDEO_TYPE') {
    response.status(400).json({ message: 'Envie apenas arquivos de video.' });
    return;
  }

  response.status(500).json({ message: 'Erro interno na API.' });
});

recoverExportJobs();
scheduleExportJobs();

const server = app.listen(PORT, () => {
  console.log(`ClipCut API running at http://localhost:${PORT}`);
  console.log(`Videos directory: ${VIDEOS_DIR}`);
});

server.on('error', (error) => {
  console.error(`ClipCut API failed to start: ${error.message}`);
  process.exitCode = 1;
});

process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
