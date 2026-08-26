const cors = require('cors');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const express = require('express');
const fs = require('fs');
const multer = require('multer');
const path = require('path');
const { createProject, isValidComposition } = require('./composition.cjs');

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
const DATA_DIR = path.join(ROOT_DIR, 'data');
const PROJECTS_DIR = path.join(DATA_DIR, 'projects');
const MANIFEST_PATH = path.join(VIDEOS_DIR, 'manifest.json');
const GALLERY_MANIFEST_PATH = path.join(GALLERY_DIR, 'manifest.json');
const AI_DIR = path.join(ROOT_DIR, 'ai');
const DEFAULT_PYTHON_BIN = path.join(ROOT_DIR, '.venv', 'Scripts', 'python.exe');
const PYTHON_BIN = process.env.PYTHON_BIN || (fs.existsSync(DEFAULT_PYTHON_BIN) ? DEFAULT_PYTHON_BIN : 'python');
const MATPLOTLIB_CACHE_DIR = path.join(ROOT_DIR, '.cache', 'matplotlib');

fs.mkdirSync(VIDEOS_DIR, { recursive: true });
fs.mkdirSync(GALLERY_DIR, { recursive: true });
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
    return readJsonFile(getSafeProjectPath(projectId), null);
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
    .map((entry) => readJsonFile(path.join(PROJECTS_DIR, entry.name), null))
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

function chunkSubtitleText(text) {
  const words = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  const chunks = [];
  let currentChunk = '';

  for (const word of words) {
    const nextChunk = currentChunk ? `${currentChunk} ${word}` : word;
    if (nextChunk.length > 72 && currentChunk) {
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

function normalizeTranscriptSegments(segments) {
  if (!Array.isArray(segments)) {
    return [];
  }

  return segments
    .map((segment) => ({
      start: Number(segment.start),
      end: Number(segment.end),
      text: String(segment.text || '').trim(),
    }))
    .filter((segment) => Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.text);
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

function getManualSubtitleEntries(clip, manualSubtitleText) {
  const chunks = chunkSubtitleText(manualSubtitleText);
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

function createSubtitleFile(packagePath, folderName, clipBaseName, video, clip, options) {
  if (options.subtitleMode === 'none') {
    return null;
  }

  const entries =
    options.subtitleMode === 'manual'
      ? getManualSubtitleEntries(clip, options.manualSubtitleText)
      : getAutomaticSubtitleEntries(video, clip);
  const correctedEntries = applySubtitleCorrections(entries, options.subtitleCorrections);

  if (correctedEntries.length === 0) {
    return null;
  }

  const fileName = `${clipBaseName}.srt`;
  const filePath = path.join(packagePath, fileName);
  writeSrtFile(filePath, correctedEntries);

  return {
    fileName,
    filePath,
    url: `/gallery/${folderName}/${fileName}`,
    entries: correctedEntries.length,
  };
}

function createSubtitleFileFromEntries(packagePath, folderName, clipBaseName, entries, corrections = []) {
  const correctedEntries = applySubtitleCorrections(entries, corrections);

  if (!Array.isArray(correctedEntries) || correctedEntries.length === 0) {
    return null;
  }

  const fileName = `${clipBaseName}.srt`;
  const filePath = path.join(packagePath, fileName);
  writeSrtFile(filePath, correctedEntries);

  return {
    fileName,
    filePath,
    url: `/gallery/${folderName}/${fileName}`,
    entries: correctedEntries.length,
  };
}

async function getFullVideoTranscript(videoPath, video) {
  const savedSegments = getSavedTranscriptSegments(video);
  if (savedSegments.length > 0) {
    return {
      ok: true,
      source: 'saved-whisperx',
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
      return {
        ok: true,
        source: transcription.engine || 'transcribe_clip',
        segments: normalizeTranscriptSegments(transcription.segments),
      };
    }

    return {
      ok: false,
      error: transcription?.message || 'A transcricao automatica nao retornou segmentos.',
    };
  } catch {
    return {
      ok: false,
      error: 'Falha ao executar o transcritor automatico.',
    };
  }
}

function createAutomaticSubtitleFile(packagePath, folderName, clipBaseName, transcript, clip, corrections) {
  if (!transcript?.ok) {
    return {
      error: transcript?.error || 'Transcricao automatica indisponivel.',
    };
  }

  const entries = getClipSubtitleEntriesFromSegments(transcript.segments, clip);
  if (entries.length === 0) {
    return {
      error: 'A transcricao nao encontrou fala dentro deste corte.',
    };
  }

  return createSubtitleFileFromEntries(packagePath, folderName, clipBaseName, entries, corrections);
}

function escapeSubtitleFilterPath(filePath) {
  return filePath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

function buildSubtitleFilter(subtitlePath, fontName, position) {
  const alignment = getSubtitleAlignment(position);
  const style = [
    `FontName=${fontName}`,
    'FontSize=24',
    'PrimaryColour=&H00FFFFFF',
    'OutlineColour=&H90000000',
    'BorderStyle=1',
    'Outline=2',
    'Shadow=0',
    `Alignment=${alignment}`,
    'MarginV=60',
  ].join(',');

  return `subtitles='${escapeSubtitleFilterPath(subtitlePath)}':force_style='${style}'`;
}

function exportClipWithFfmpeg(sourcePath, targetPath, clip, subtitleOptions = null) {
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
    '-t',
    String(Math.max(Number(clip.durationSeconds || 1), 1)),
  ];

  if (subtitleOptions?.subtitlePath) {
    command.push(
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
    command.push('-c', 'copy');
  }

  command.push('-avoid_negative_ts', 'make_zero', targetPath);

  const result = spawnSync(ffmpegBin, command, { encoding: 'utf8', windowsHide: true });

  if (result.status === 0 && fs.existsSync(targetPath)) {
    return { ok: true, mode: subtitleOptions?.subtitlePath ? 'ffmpeg-subtitle' : 'ffmpeg-copy' };
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

const app = express();

app.use(cors());
app.use(express.json());
app.use('/videos', express.static(VIDEOS_DIR));
app.use('/gallery', express.static(GALLERY_DIR));

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
  const { videoId, clipIds, title } = request.body || {};
  const { video } = getVideoById(videoId);

  if (!video) {
    response.status(404).json({ message: 'Video nao encontrado.' });
    return;
  }

  const requestedClipIds = Array.isArray(clipIds) ? clipIds : [];
  const availableClips = Array.isArray(video.clips) ? video.clips : [];
  const selectedClips =
    requestedClipIds.length > 0
      ? availableClips.filter((clip) => requestedClipIds.includes(clip.id))
      : availableClips;
  const project = createProject(video, selectedClips);

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

app.put('/api/compositions/:id', (request, response) => {
  const { project, composition: currentComposition } = findComposition(request.params.id);
  const incomingComposition = request.body?.composition || request.body;
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

  const savedComposition = {
    ...incomingComposition,
    id: currentComposition.id,
    projectId: project.id,
    revision: currentComposition.revision + 1,
    updatedAt: new Date().toISOString(),
  };
  const updatedProject = {
    ...project,
    compositions: project.compositions.map((composition) =>
      composition.id === currentComposition.id ? savedComposition : composition,
    ),
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
    clipIds,
    subtitleMode = 'automatic',
    manualSubtitleText = '',
    subtitleCorrections = '',
    subtitleFont = 'inter',
    subtitlePosition = 'bottom',
    audioMode = 'Audio original',
  } = request.body || {};
  const { video } = getVideoById(videoId);

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
  const fontName = getSubtitleFontName(subtitleFont);
  const parsedSubtitleCorrections = parseSubtitleCorrections(subtitleCorrections);
  const fullVideoTranscript =
    normalizedSubtitleMode === 'automatic' ? await getFullVideoTranscript(videoPath, video) : null;
  const exportedClips = [];

  for (const [index, clip] of selectedClips.entries()) {
    const clipBaseName = sanitizeFileName(`${index + 1}-${clip.title}`) || `clip-${index + 1}`;
    const exportedFileName = `${clipBaseName}${extension}`;
    const exportedPath = path.join(packagePath, exportedFileName);
    const subtitleFile =
      normalizedSubtitleMode === 'automatic'
        ? createAutomaticSubtitleFile(
            packagePath,
            folderName,
            clipBaseName,
            fullVideoTranscript,
            clip,
            parsedSubtitleCorrections,
          )
        : createSubtitleFile(packagePath, folderName, clipBaseName, video, clip, {
            subtitleMode: normalizedSubtitleMode,
            manualSubtitleText,
            subtitleCorrections: parsedSubtitleCorrections,
          });
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
    );

    exportedClips.push({
      ...clip,
      shouldCaption: Boolean(subtitleFile?.filePath),
      subtitleMode: normalizedSubtitleMode,
      subtitleFont,
      subtitlePosition,
      subtitlePath: subtitleFile?.url || null,
      subtitleError: subtitleFile?.error || null,
      subtitleSource: fullVideoTranscript?.source || null,
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
    createdAt: new Date().toISOString(),
    subtitleMode: normalizedSubtitleMode,
    subtitleFont,
    subtitlePosition,
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
