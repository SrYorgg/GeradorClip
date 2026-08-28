const cors = require('cors');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const express = require('express');
const fs = require('fs');
const multer = require('multer');
const os = require('os');
const path = require('path');
const { createProject, isValidComposition, normalizeComposition, reviewComposition } = require('./composition.cjs');

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

function getVideoById(id) {
  const videos = readManifest();
  const video = videos.find((item) => item.id === id);
  return { videos, video };
}

function getSafeVideoPath(fileName) {
  const videoPath = path.join(VIDEOS_DIR, fileName);
  const resolvedVideoPath = path.resolve(videoPath);

  if (!resolvedVideoPath.startsWith(VIDEOS_DIR)) {
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
  const galleryPath = path.join(GALLERY_DIR, folderName);
  const resolvedGalleryPath = path.resolve(galleryPath);

  if (!resolvedGalleryPath.startsWith(GALLERY_DIR)) {
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

function formatClipTime(seconds) {
  const minutes = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0');
  const remainingSeconds = Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0');

  return `${minutes}:${remainingSeconds}`;
}

function findExecutable(name, envName) {
  if (process.env[envName] && fs.existsSync(process.env[envName])) {
    return process.env[envName];
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

function formatSrtTimestamp(seconds) {
  const totalMilliseconds = Math.max(Math.round(Number(seconds || 0) * 1000), 0);
  const hours = Math.floor(totalMilliseconds / 3600000);
  const minutes = Math.floor((totalMilliseconds % 3600000) / 60000);
  const wholeSeconds = Math.floor((totalMilliseconds % 60000) / 1000);
  const milliseconds = totalMilliseconds % 1000;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(
    2,
    '0',
  )},${String(milliseconds).padStart(3, '0')}`;
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

function writeSrtFile(filePath, entries) {
  const content = entries
    .map((entry, index) =>
      [
        String(index + 1),
        `${formatSrtTimestamp(entry.start)} --> ${formatSrtTimestamp(entry.end)}`,
        entry.text,
      ].join('\n'),
    )
    .join('\n\n');

  fs.writeFileSync(filePath, `${content}\n`, 'utf8');
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
  return {
    mode: ['none', 'automatic', 'manual'].includes(settings.mode) ? settings.mode : 'automatic',
    manualText: String(settings.manualText || ''),
    corrections: String(settings.corrections || ''),
    font: String(settings.font || 'inter'),
    position: ['top', 'middle', 'bottom'].includes(settings.position) ? settings.position : 'bottom',
    displayMode: ['block', 'word'].includes(settings.displayMode) ? settings.displayMode : 'block',
    language: ['original', 'pt-BR'].includes(settings.language) ? settings.language : 'pt-BR',
  };
}

function getCaptionPlacement(position) {
  const normalizedPosition = position === 'top' || position === 'middle' ? position : 'bottom';
  const values = {
    top: { anchor: 'top', xPct: 50, yPct: 12 },
    middle: { anchor: 'center', xPct: 50, yPct: 50 },
    bottom: { anchor: 'bottom', xPct: 50, yPct: 86 },
  };
  const selected = values[normalizedPosition];

  return {
    ...selected,
    maxWidthPct: 84,
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
    placement: getCaptionPlacement(settings.position),
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

function writeAssFile(filePath, entries, fontName, position, canvasWidth = 1080, canvasHeight = 1920) {
  const alignment = getSubtitleAlignment(position);
  const groups = groupSubtitleWords(entries);
  const dialogue = groups.map((group) => {
    const text = group
      .map((entry) => {
        const duration = Math.max(Math.round((Number(entry.end) - Number(entry.start)) * 100), 1);
        return `{\\kf${duration}}${escapeAssText(entry.text)}`;
      })
      .join(' ');

    return `Dialogue: 0,${formatAssTimestamp(group[0].start)},${formatAssTimestamp(group[group.length - 1].end)},Default,,0,0,0,,${text}`;
  });
  const content = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${canvasWidth}`,
    `PlayResY: ${canvasHeight}`,
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, TertiaryColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, AlphaLevel, Encoding',
    `Style: Default,${fontName || 'Arial'},${SUBTITLE_FONT_SIZE},&H00FFFFFF,&H00A8A8A8,&H00000000,&H90000000,0,0,1,2,0,${alignment},72,72,60,0,1`,
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
    const persistedEntries = options.subtitleDisplayMode === 'word'
      ? getCaptionWordEntries(options.captionTrack)
      : getCaptionCueEntries(options.captionTrack);
    return createSubtitleFileFromEntries(packagePath, folderName, clipBaseName, persistedEntries, [], {
      displayMode: options.subtitleDisplayMode,
      fontName: options.subtitleFontName,
      position: options.subtitlePosition,
      canvasWidth: options.canvasWidth,
      canvasHeight: options.canvasHeight,
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
  });
}

function createSubtitleFileFromEntries(packagePath, folderName, clipBaseName, entries, corrections = [], options = {}) {
  const correctedEntries = applySubtitleCorrections(entries, corrections);

  if (!Array.isArray(correctedEntries) || correctedEntries.length === 0) {
    return null;
  }

  const isWordMode = options.displayMode === 'word';
  const fileName = `${clipBaseName}.${isWordMode ? 'ass' : 'srt'}`;
  const filePath = path.join(packagePath, fileName);
  if (isWordMode) {
    writeAssFile(filePath, correctedEntries, options.fontName, options.position, options.canvasWidth, options.canvasHeight);
  } else {
    writeSrtFile(filePath, correctedEntries);
  }

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

  const translationDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geradorclip-translation-'));
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
    const persistedEntries = options.displayMode === 'word'
      ? getCaptionWordEntries(persistedCaptionTrack)
      : getCaptionCueEntries(persistedCaptionTrack);
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

function buildSubtitleFilter(subtitlePath, fontName, position, canvasWidth = 1080, canvasHeight = 1920) {
  if (path.extname(subtitlePath).toLowerCase() === '.ass') {
    return `ass='${escapeSubtitleFilterPath(subtitlePath)}'`;
  }

  const alignment = getSubtitleAlignment(position);
  const style = [
    `FontName=${fontName}`,
    `FontSize=${SUBTITLE_FONT_SIZE}`,
    'PrimaryColour=&H00FFFFFF',
    'OutlineColour=&H90000000',
    'BorderStyle=1',
    'Outline=2',
    'Shadow=0',
    `Alignment=${alignment}`,
    'MarginV=60',
    'MarginL=72',
    'MarginR=72',
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
    filters.push(`[${currentLabel}]${buildSubtitleFilter(subtitleOptions.subtitlePath, subtitleOptions.fontName, subtitleOptions.position, canvasWidth, canvasHeight)}[captioned]`);
    outputLabel = 'captioned';
  }

  return {
    filterComplex: filters.join(';'),
    inputPaths,
    outputLabel,
  };
}

function exportClipWithFfmpeg(sourcePath, targetPath, clip, subtitleOptions = null, composition = null, project = null) {
  const ffmpegBin = findExecutable('ffmpeg', 'FFMPEG_BIN');

  if (!ffmpegBin) {
    fs.copyFileSync(sourcePath, targetPath);
    return { ok: false, mode: 'copy', message: 'ffmpeg nao encontrado; video original copiado.' };
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
      buildSubtitleFilter(subtitleOptions.subtitlePath, subtitleOptions.fontName, subtitleOptions.position),
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

  const result = spawnSync(ffmpegBin, command, { encoding: 'utf8', windowsHide: true });

  if (result.status === 0 && fs.existsSync(targetPath)) {
    return {
      ok: true,
      mode: compositionRender ? 'ffmpeg-layout' : subtitleOptions?.subtitlePath ? 'ffmpeg-subtitle' : 'ffmpeg-copy',
    };
  }

  fs.copyFileSync(sourcePath, targetPath);
  return { ok: false, mode: 'copy', message: result.stderr || 'Falha ao recortar com ffmpeg.' };
}

function clampNumber(value, min, max, fallback) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(numberValue)));
}

function buildSuggestedClips(video, options = {}) {
  const duration = Math.max(Number(video.durationSeconds || 0), 1);
  const mode = options.mode === 'count' ? 'count' : 'duration';
  const targetDurationSeconds = clampNumber(options.targetDurationSeconds, 5, 600, 60);
  const targetClipCount = clampNumber(options.targetClipCount, 1, 50, 5);
  const clipCount =
    mode === 'count'
      ? Math.min(targetClipCount, Math.ceil(duration))
      : Math.max(1, Math.ceil(duration / targetDurationSeconds));
  const clipDuration = mode === 'count' ? duration / clipCount : targetDurationSeconds;
  const starts = Array.from({ length: clipCount }, (_, index) => Math.floor(index * clipDuration));

  return starts.map((start, index) => {
    const end = Math.min(duration, index === starts.length - 1 ? duration : Math.floor((index + 1) * clipDuration));
    const clipNumber = String(index + 1).padStart(2, '0');

    return {
      id: crypto.randomUUID(),
      videoId: video.id,
      title: `Corte ${clipNumber}`,
      sourceName: video.originalName,
      startSeconds: start,
      endSeconds: end,
      durationSeconds: Math.max(end - start, 1),
      duration: formatClipTime(Math.max(end - start, 1)),
      range: `${formatClipTime(start)} - ${formatClipTime(end)}`,
      status: 'Pronto',
      shouldCaption: false,
      createdAt: new Date().toISOString(),
    };
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
    response.status(400).json({ message: 'Nao foi possivel gerar cortes para este video.' });
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
  response.status(201).json({ project: updatedProject });
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
  const captionSettingsChanged = JSON.stringify(incomingComposition.captionSettings || {}) !== JSON.stringify(currentComposition.captionSettings || {});
  const savedComposition = {
    ...incomingComposition,
    id: currentComposition.id,
    projectId: project.id,
    captionTrack: captionSettingsChanged ? undefined : incomingComposition.captionTrack,
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

  const clips = buildSuggestedClips(video, request.body || {});
  const updatedVideo = updateVideo(video.id, (currentVideo) => ({
    ...currentVideo,
    clips,
    clipsGeneratedAt: new Date().toISOString(),
  }));

  response.status(201).json({ video: updatedVideo, clips });
});

app.get('/api/gallery', (_request, response) => {
  const packages = readGalleryManifest().sort((first, second) =>
    second.createdAt.localeCompare(first.createdAt),
  );

  response.json({ packages });
});

app.post('/api/gallery/export', async (request, response) => {
  const {
    videoId,
    projectId,
    clipIds,
    compositionIds,
    subtitleMode = 'automatic',
    manualSubtitleText = '',
    subtitleCorrections = '',
    subtitleFont = 'inter',
    subtitlePosition = 'bottom',
    subtitleDisplayMode = 'block',
    subtitleLanguage = 'pt-BR',
    audioMode = 'Audio original',
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
  const selectedClips =
    requestedClipIds.length > 0
      ? sourceClips.filter((clip) => requestedClipIds.includes(clip.id))
      : sourceClips;

  if (selectedClips.length === 0) {
    response.status(400).json({ message: 'Nenhum clipe selecionado para exportar.' });
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

  const packageId = crypto.randomUUID();
  const folderName = `${Date.now()}-${packageId}`;
  let packagePath;

  try {
    packagePath = getSafeGalleryPath(folderName);
  } catch {
    response.status(400).json({ message: 'Caminho de galeria invalido.' });
    return;
  }

  fs.mkdirSync(packagePath, { recursive: true });

  const extension = path.extname(video.fileName) || '.mp4';
  const normalizedSubtitleMode = ['automatic', 'manual', 'none'].includes(subtitleMode) ? subtitleMode : 'automatic';
  const normalizedSubtitleDisplayMode = ['block', 'word'].includes(subtitleDisplayMode) ? subtitleDisplayMode : 'block';
  const normalizedSubtitleLanguage = ['original', 'pt-BR'].includes(subtitleLanguage) ? subtitleLanguage : 'pt-BR';
  const fontName = getSubtitleFontName(subtitleFont);
  const parsedSubtitleCorrections = parseSubtitleCorrections(subtitleCorrections);
  const compositionByClip = new Map(selectedCompositions.map((composition) => [composition.clipId, composition]));
  const needsTranscript = normalizedSubtitleMode === 'automatic' && (
    !project || selectedClips.some((clip) => {
      const captionTrack = compositionByClip.get(clip.id)?.captionTrack;
      return !captionTrack?.cues?.length && !captionTrack?.words?.length;
    })
  );
  const fullVideoTranscript =
    needsTranscript ? await getFullVideoTranscript(videoPath, video) : null;
  const exportedClips = [];

  for (const [index, clip] of selectedClips.entries()) {
    const clipBaseName = sanitizeFileName(`${index + 1}-${clip.title}`) || `clip-${index + 1}`;
    const exportedFileName = `${clipBaseName}${extension}`;
    const exportedPath = path.join(packagePath, exportedFileName);
    const composition = selectedCompositions.find((currentComposition) => currentComposition.clipId === clip.id) || null;
    const subtitleCanvas = composition?.canvas || { width: 1080, height: 1920 };
    const subtitleFile =
      normalizedSubtitleMode === 'automatic'
        ? await createAutomaticSubtitleFile(
            packagePath,
            folderName,
            clipBaseName,
            fullVideoTranscript,
            clip,
            parsedSubtitleCorrections,
            {
              displayMode: normalizedSubtitleDisplayMode,
              fontName,
              position: subtitlePosition,
              canvasWidth: subtitleCanvas.width,
              canvasHeight: subtitleCanvas.height,
              subtitleLanguage: normalizedSubtitleLanguage,
              captionTrack: composition?.captionTrack,
            },
          )
        : await createSubtitleFile(packagePath, folderName, clipBaseName, video, clip, {
            subtitleMode: normalizedSubtitleMode,
            manualSubtitleText,
            subtitleCorrections: parsedSubtitleCorrections,
            subtitleDisplayMode: normalizedSubtitleDisplayMode,
            subtitleFontName: fontName,
            subtitlePosition,
            canvasWidth: subtitleCanvas.width,
            canvasHeight: subtitleCanvas.height,
            subtitleLanguage: normalizedSubtitleLanguage,
            captionTrack: composition?.captionTrack,
          });
    if (subtitleFile?.error) {
      console.error(`[captions] export blocked for clip ${clip.id}: ${subtitleFile.error}`);
      fs.rmSync(packagePath, { recursive: true, force: true });
      response.status(422).json({ message: subtitleFile.error });
      return;
    }
    const exportResult = exportClipWithFfmpeg(
      videoPath,
      exportedPath,
      clip,
      subtitleFile?.filePath
        ? {
            subtitlePath: subtitleFile.filePath,
            fontName,
            position: subtitlePosition,
          }
        : null,
      composition,
      project,
    );

    exportedClips.push({
      ...clip,
      shouldCaption: Boolean(subtitleFile?.filePath),
      subtitleMode: normalizedSubtitleMode,
      subtitleFont,
      subtitlePosition,
      subtitleDisplayMode: normalizedSubtitleDisplayMode,
      subtitleLanguage: normalizedSubtitleLanguage,
      subtitlePath: subtitleFile?.url || null,
      subtitleError: subtitleFile?.error || null,
      subtitleSource: composition?.captionTrack ? 'composition-caption-track' : fullVideoTranscript?.source || null,
      subtitleCorrections: parsedSubtitleCorrections.length,
      audioMode,
      exportResult,
      fileName: exportedFileName,
      url: `/gallery/${folderName}/${exportedFileName}`,
    });
  }

  const galleryPackage = {
    id: packageId,
    title: `Pacote - ${video.originalName}`,
    folderName,
    folderUrl: `/gallery/${folderName}`,
    sourceVideoId: video.id,
    sourceName: video.originalName,
    projectId: project?.id || null,
    compositionIds: selectedCompositions.map((composition) => composition.id),
    canvas: selectedCompositions[0]?.canvas || null,
    createdAt: new Date().toISOString(),
    subtitleMode: normalizedSubtitleMode,
    subtitleFont,
    subtitlePosition,
    subtitleDisplayMode: normalizedSubtitleDisplayMode,
    subtitleLanguage: normalizedSubtitleLanguage,
    subtitleCorrections: parsedSubtitleCorrections.length,
    audioMode,
    clips: exportedClips,
  };

  writeJsonFile(path.join(packagePath, 'package.json'), galleryPackage);

  const packages = readGalleryManifest();
  packages.push(galleryPackage);
  writeGalleryManifest(packages);

  response.status(201).json({ package: galleryPackage });
});

app.post('/api/videos', upload.single('video'), (request, response) => {
  if (!request.file) {
    response.status(400).json({ message: 'Nenhum video foi enviado.' });
    return;
  }

  const durationSeconds = Number(request.body.durationSeconds || 0);
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

const server = app.listen(PORT, () => {
  console.log(`GeradorClip API running at http://localhost:${PORT}`);
  console.log(`Videos directory: ${VIDEOS_DIR}`);
});

server.on('error', (error) => {
  console.error(`GeradorClip API failed to start: ${error.message}`);
  process.exitCode = 1;
});

process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
