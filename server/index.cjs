const cors = require('cors');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const express = require('express');
const fs = require('fs');
const multer = require('multer');
const path = require('path');

const PORT = Number(process.env.API_PORT || 3333);
const ROOT_DIR = path.resolve(__dirname, '..');
const VIDEOS_DIR = path.join(ROOT_DIR, 'public', 'videos');
const GALLERY_DIR = path.join(ROOT_DIR, 'public', 'gallery');
const MANIFEST_PATH = path.join(VIDEOS_DIR, 'manifest.json');
const GALLERY_MANIFEST_PATH = path.join(GALLERY_DIR, 'manifest.json');
const AI_DIR = path.join(ROOT_DIR, 'ai');
const DEFAULT_PYTHON_BIN = path.join(ROOT_DIR, '.venv', 'Scripts', 'python.exe');
const PYTHON_BIN = process.env.PYTHON_BIN || (fs.existsSync(DEFAULT_PYTHON_BIN) ? DEFAULT_PYTHON_BIN : 'python');
const MATPLOTLIB_CACHE_DIR = path.join(ROOT_DIR, '.cache', 'matplotlib');

fs.mkdirSync(VIDEOS_DIR, { recursive: true });
fs.mkdirSync(GALLERY_DIR, { recursive: true });
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

function exportClipWithFfmpeg(sourcePath, targetPath, clip) {
  const ffmpegBin = findExecutable('ffmpeg', 'FFMPEG_BIN');

  if (!ffmpegBin) {
    fs.copyFileSync(sourcePath, targetPath);
    return { ok: false, mode: 'copy', message: 'ffmpeg nao encontrado; video original copiado.' };
  }

  const result = spawnSync(
    ffmpegBin,
    [
      '-y',
      '-ss',
      String(Math.max(Number(clip.startSeconds || 0), 0)),
      '-i',
      sourcePath,
      '-t',
      String(Math.max(Number(clip.durationSeconds || 1), 1)),
      '-c',
      'copy',
      '-avoid_negative_ts',
      'make_zero',
      targetPath,
    ],
    { encoding: 'utf8', windowsHide: true },
  );

  if (result.status === 0 && fs.existsSync(targetPath)) {
    return { ok: true, mode: 'ffmpeg-copy' };
  }

  fs.copyFileSync(sourcePath, targetPath);
  return { ok: false, mode: 'copy', message: result.stderr || 'Falha ao recortar com ffmpeg.' };
}

function buildSuggestedClips(video) {
  const duration = Math.max(Number(video.durationSeconds || 0), 1);
  const clipDuration = Math.min(60, Math.max(20, Math.floor(duration / 4)));
  const starts = [
    0,
    Math.max(0, Math.floor(duration * 0.28)),
    Math.max(0, Math.floor(duration * 0.62)),
  ];
  const titles = ['Gancho principal', 'Trecho de desenvolvimento', 'Chamada final'];

  return starts.map((start, index) => {
    const end = Math.min(duration, start + clipDuration);

    return {
      id: crypto.randomUUID(),
      videoId: video.id,
      title: titles[index],
      sourceName: video.originalName,
      startSeconds: start,
      endSeconds: end,
      durationSeconds: Math.max(end - start, 1),
      duration: formatClipTime(Math.max(end - start, 1)),
      range: `${formatClipTime(start)} - ${formatClipTime(end)}`,
      status: 'Pronto',
      shouldCaption: true,
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

app.post('/api/videos/:id/clips', (request, response) => {
  const { video } = getVideoById(request.params.id);

  if (!video) {
    response.status(404).json({ message: 'Video nao encontrado.' });
    return;
  }

  const clips = buildSuggestedClips(video);
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

app.post('/api/gallery/export', (request, response) => {
  const { videoId, clipIds, captionClipIds = [], subtitleMode = 'Legenda automatica', audioMode = 'Audio original' } =
    request.body || {};
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
  const exportedClips = selectedClips.map((clip, index) => {
    const clipBaseName = sanitizeFileName(`${index + 1}-${clip.title}`) || `clip-${index + 1}`;
    const exportedFileName = `${clipBaseName}${extension}`;
    const exportedPath = path.join(packagePath, exportedFileName);
    const exportResult = exportClipWithFfmpeg(videoPath, exportedPath, clip);

    return {
      ...clip,
      shouldCaption: captionClipIds.includes(clip.id),
      subtitleMode,
      audioMode,
      exportResult,
      fileName: exportedFileName,
      url: `/gallery/${folderName}/${exportedFileName}`,
    };
  });

  const galleryPackage = {
    id: packageId,
    title: `Pacote - ${video.originalName}`,
    folderName,
    folderUrl: `/gallery/${folderName}`,
    sourceVideoId: video.id,
    sourceName: video.originalName,
    createdAt: new Date().toISOString(),
    subtitleMode,
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

app.listen(PORT, () => {
  console.log(`GeradorClip API running at http://localhost:${PORT}`);
  console.log(`Videos directory: ${VIDEOS_DIR}`);
});
