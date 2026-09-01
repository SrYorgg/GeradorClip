import type { Canvas, CaptionSettings, Composition, LayoutConfig, Project, ProjectAsset, ProjectSummary } from '../features/editor/domain/editor.types';
import type {
  EditorialConfig,
  EditorialProviderStatus,
  EditorialScore,
} from '../features/editorial/domain/editorial.types';

export type UploadedVideo = {
  id: string;
  originalName: string;
  fileName: string;
  type: string;
  size: number;
  durationSeconds: number;
  createdAt: string;
  url: string;
  clips?: GeneratedClip[];
  clipsGeneratedAt?: string;
  aiStatus?: 'pending' | 'processing' | 'done' | 'error';
  analysis?: VideoAnalysis | null;
  analysisError?: string | null;
  sourceType?: 'file' | 'url';
  sourceUrl?: string;
  sourceProvider?: 'youtube' | 'external';
  audienceRecommendations?: AudienceRecommendation[];
  audienceInsight?: AudienceInsight;
};

export type AudienceRecommendation = {
  id: string;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  intensity: number;
  score: number;
  source: 'youtube-most-replayed' | 'local-ai';
  rank: number;
  reason?: string;
  signals?: {
    speech?: number;
    hook?: number;
    visual?: number;
    face?: number;
    prompt?: number;
    pauses?: number;
    fillers?: number;
  };
};

export type BrollSuggestion = {
  id: string;
  startSeconds: number;
  endSeconds: number;
  title: string;
  prompt: string;
  reason: string;
  source: 'transcript-keywords';
  status: 'suggested' | 'used';
};

export type VoiceoverAsset = {
  id: string;
  type: 'audio';
  name: string;
  fileName: string;
  url: string;
};

export type AudienceInsight = {
  source: 'youtube-most-replayed' | null;
  available: boolean;
  markers: number;
  message: string | null;
  fetchedAt: string;
};

export type GeneratedClip = {
  id: string;
  videoId: string;
  title: string;
  sourceName: string;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  duration: string;
  range: string;
  status: 'Pronto' | 'Renderizando' | 'Revisar';
  shouldCaption: boolean;
  createdAt: string;
  fileName?: string;
  url?: string;
  subtitleMode?: string;
  subtitleFont?: string;
  subtitlePosition?: string;
  subtitleDisplayMode?: string;
  subtitleEffect?: string;
  subtitleLanguage?: string;
  subtitlePath?: string | null;
  subtitleError?: string | null;
  subtitleSource?: string | null;
  subtitleCorrections?: number;
  audioMode?: string;
  recommendationScore?: number;
  recommendationSource?: 'youtube-most-replayed' | 'local-ai';
  recommendationReason?: string;
  recommendationPrompt?: string;
};

export type ExportJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type ExportJobPhase = 'preflight' | 'captions' | 'render' | 'validate' | 'cleanup';
export type ExportJobClipStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export type ExportJobClipResult = {
  clipId: string;
  title: string;
  status: ExportJobClipStatus;
  phase: ExportJobPhase;
  progress: number;
  attempts: number;
  errorCode?: string | null;
  error?: string | null;
  fileName?: string;
  url?: string;
  shouldCaption?: boolean;
  subtitleMode?: string;
  subtitleFont?: string;
  subtitlePosition?: string;
  subtitleDisplayMode?: string;
  subtitleEffect?: string;
  subtitleLanguage?: string;
  subtitlePath?: string | null;
  subtitleSource?: string | null;
  subtitleCorrections?: number;
  audioMode?: string;
  exportResult?: {
    ok: boolean;
    mode?: string;
    message?: string;
  };
};

export type ExportJob = {
  version: number;
  id: string;
  status: ExportJobStatus;
  phase: ExportJobPhase;
  progress: number;
  videoId: string;
  sourceName: string;
  projectId?: string | null;
  clipIds: string[];
  compositionIds?: string[];
  inputRevision?: number;
  packageId: string;
  folderName: string;
  options: {
    subtitleMode: string;
    manualSubtitleText?: string;
    subtitleCorrections?: Array<{ from: string; to: string }>;
    subtitleFont: string;
    subtitlePosition: string;
    subtitleDisplayMode: string;
    subtitleEffect?: string;
    subtitleLanguage: string;
    audioMode: string;
    audioEnhancement?: boolean;
    removeSilence?: boolean;
    removeFillers?: boolean;
    voiceoverAsset?: VoiceoverAsset | null;
  };
  clipResults: ExportJobClipResult[];
  outputPaths?: string[];
  galleryPackageId?: string | null;
  retryCount: number;
  cancelRequested?: boolean;
  currentClipId?: string | null;
  errorCode?: string | null;
  error?: string | null;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  updatedAt: string;
};

export type GalleryPackage = {
  id: string;
  jobId?: string | null;
  title: string;
  folderName: string;
  folderUrl: string;
  sourceVideoId: string;
  sourceName: string;
  projectId?: string | null;
  compositionIds?: string[];
  canvas?: Canvas | null;
  createdAt: string;
  subtitleMode: string;
  subtitleFont: string;
  subtitlePosition: string;
  subtitleDisplayMode?: string;
  subtitleEffect?: string;
  subtitleCorrections?: number;
  audioMode: string;
  audioEnhancement?: boolean;
  removeSilence?: boolean;
  removeFillers?: boolean;
  voiceoverAsset?: Pick<VoiceoverAsset, 'id' | 'name'> | null;
  clips: GeneratedClip[];
};

export type EditorialAnalysis = {
  model: string;
  confidence: string;
  score: EditorialScore;
};

export type VideoAnalysis = {
  tools?: {
    ffmpeg?: AiToolResult;
    whisperx?: AiToolResult & {
      text?: string;
      language?: string;
      segments?: unknown[];
    };
    mediapipe?: AiToolResult & {
      sampledFrames?: number;
      framesWithFaces?: number;
      maxFaces?: number;
      faceSamples?: Array<{
        timeSeconds: number;
        faceCount: number;
        faces?: Array<{
          x: number;
          y: number;
          width: number;
          height: number;
          centerX: number;
          centerY: number;
          confidence?: number;
        }>;
        primaryFace?: {
          x: number;
          y: number;
          width: number;
          height: number;
          centerX: number;
          centerY: number;
          confidence?: number;
        } | null;
        motion?: number;
      }>;
      faceTracking?: Array<{
        timeMs: number;
        x: number;
        y: number;
        scale: number;
        rotation?: number;
      }>;
    };
    pyannote?: AiToolResult & {
      turns?: unknown[];
    };
    ollama?: AiToolResult & {
      model?: string;
      response?: string;
    };
  };
  brollSuggestions?: BrollSuggestion[];
};

export type AiToolResult = {
  available?: boolean;
  ok?: boolean;
  message?: string;
};

async function assertApiResponse(response: Response) {
  if (!response.ok) {
    let message = `API request failed with status ${response.status}`;
    try {
      const data = (await response.json()) as { message?: string };
      message = data.message || message;
    } catch {
      // Keep the HTTP status when the server does not return JSON.
    }
    throw new Error(message);
  }
}

export async function uploadVideo(file: File, durationSeconds: number) {
  const formData = new FormData();
  formData.append('video', file);
  formData.append('durationSeconds', String(durationSeconds));

  const response = await fetch('/api/videos', {
    method: 'POST',
    body: formData,
  });

  await assertApiResponse(response);

  const data = (await response.json()) as { video: UploadedVideo };
  return data.video;
}

export async function importVideoFromUrl(url: string) {
  const response = await fetch('/api/videos/import-url', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url }),
  });
  await assertApiResponse(response);

  const data = (await response.json()) as { video: UploadedVideo };
  return data.video;
}

export async function listUploadedVideos() {
  const response = await fetch('/api/videos');
  await assertApiResponse(response);

  const data = (await response.json()) as { videos: UploadedVideo[] };
  return data.videos;
}

export async function listGeneratedClips() {
  const response = await fetch('/api/clips');
  await assertApiResponse(response);

  const data = (await response.json()) as { clips: GeneratedClip[] };
  return data.clips;
}

export async function generateVideoClips(
  id: string,
  options: {
    mode: 'duration' | 'count' | 'recommended' | 'best-moments';
    targetDurationSeconds: number;
    targetClipCount: number;
    focusPrompt?: string;
  },
) {
  const response = await fetch(`/api/videos/${id}/clips`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(options),
  });

  await assertApiResponse(response);

  const data = (await response.json()) as { video: UploadedVideo; clips: GeneratedClip[]; maxClipCount?: number };
  return data;
}

export async function listGalleryPackages() {
  const response = await fetch('/api/gallery');
  await assertApiResponse(response);

  const data = (await response.json()) as { packages: GalleryPackage[] };
  return data.packages;
}

export async function listExportJobs() {
  const response = await fetch('/api/export-jobs');
  await assertApiResponse(response);

  const data = (await response.json()) as { jobs: ExportJob[] };
  return data.jobs;
}

export async function getExportJob(id: string) {
  const response = await fetch(`/api/export-jobs/${id}`);
  await assertApiResponse(response);

  const data = (await response.json()) as { job: ExportJob };
  return data.job;
}

export async function cancelExportJob(id: string) {
  const response = await fetch(`/api/export-jobs/${id}/cancel`, {
    method: 'POST',
  });
  await assertApiResponse(response);

  const data = (await response.json()) as { job: ExportJob };
  return data.job;
}

export async function retryExportJob(id: string, clipId?: string) {
  const response = await fetch(`/api/export-jobs/${id}/retry`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(clipId ? { clipId } : {}),
  });
  await assertApiResponse(response);

  const data = (await response.json()) as { job: ExportJob };
  return data.job;
}

export async function exportClipsToGallery(payload: {
  videoId: string;
  projectId?: string;
  clipIds: string[];
  compositionIds?: string[];
  subtitleMode: string;
  manualSubtitleText: string;
  subtitleCorrections: string;
  subtitleFont: string;
  subtitlePosition: string;
  subtitleDisplayMode: string;
  subtitleLanguage: string;
  audioMode: string;
  captionSettings?: CaptionSettings;
  audioEnhancement?: boolean;
  removeSilence?: boolean;
  removeFillers?: boolean;
  voiceoverAsset?: VoiceoverAsset | null;
}) {
  const response = await fetch('/api/gallery/export', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  await assertApiResponse(response);

  const data = (await response.json()) as { job: ExportJob };
  return data.job;
}

export async function uploadAudioAsset(file: File) {
  const formData = new FormData();
  formData.append('audio', file);

  const response = await fetch('/api/audio-assets', {
    method: 'POST',
    body: formData,
  });

  await assertApiResponse(response);

  const data = (await response.json()) as { asset: VoiceoverAsset };
  return data.asset;
}

export async function deleteUploadedVideo(id: string) {
  const response = await fetch(`/api/videos/${id}`, {
    method: 'DELETE',
  });

  await assertApiResponse(response);
}

export async function analyzeUploadedVideo(id: string) {
  const response = await fetch(`/api/videos/${id}/analyze`, {
    method: 'POST',
  });

  await assertApiResponse(response);

  const data = (await response.json()) as { video: UploadedVideo };
  return data.video;
}

export async function getAiStatus() {
  const response = await fetch('/api/ai/status');
  await assertApiResponse(response);

  const data = (await response.json()) as {
    status: Record<string, boolean>;
  };
  return data.status;
}

export async function getEditorialConfig() {
  const response = await fetch('/api/editorial/config');
  await assertApiResponse(response);

  const data = (await response.json()) as { config: EditorialConfig };
  return data.config;
}

export async function saveEditorialConfig(config: EditorialConfig) {
  const response = await fetch('/api/editorial/config', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(config),
  });
  await assertApiResponse(response);

  const data = (await response.json()) as { config: EditorialConfig };
  return data.config;
}

export async function getEditorialStatus() {
  const response = await fetch('/api/editorial/status');
  await assertApiResponse(response);

  const data = (await response.json()) as { status: EditorialProviderStatus };
  return data.status;
}

export async function analyzeProjectEditorial(projectId: string) {
  const response = await fetch(`/api/projects/${projectId}/editorial/analyze`, {
    method: 'POST',
  });
  await assertApiResponse(response);

  const data = (await response.json()) as { project: Project };
  return data.project;
}

export async function saveCompositionEditorial(
  projectId: string,
  compositionId: string,
  payload: { title: string; description: string },
) {
  const response = await fetch(`/api/projects/${projectId}/compositions/${compositionId}/editorial`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  await assertApiResponse(response);

  const data = (await response.json()) as { project: Project };
  return data.project;
}

export async function listProjects() {
  const response = await fetch('/api/projects');
  await assertApiResponse(response);

  const data = (await response.json()) as { projects: ProjectSummary[] };
  return data.projects;
}

export async function createProject(payload: {
  videoId: string;
  clipIds?: string[];
  title?: string;
  layout?: LayoutConfig;
  layoutOnly?: boolean;
}) {
  const response = await fetch('/api/projects', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  await assertApiResponse(response);

  const data = (await response.json()) as { project: Project };
  return data.project;
}

export async function generateProjectClips(projectId: string) {
  const response = await fetch(`/api/projects/${projectId}/generate-clips`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      mode: 'duration',
      targetDurationSeconds: 60,
      targetClipCount: 1,
    }),
  });

  await assertApiResponse(response);

  const data = (await response.json()) as { project: Project };
  return data.project;
}

export async function uploadProjectImage(
  projectId: string,
  file: File,
  options: { addToLayout?: boolean } = {},
) {
  const formData = new FormData();
  formData.append('image', file);
  if (options.addToLayout) {
    formData.append('addToLayout', 'true');
  }

  const response = await fetch(`/api/projects/${projectId}/assets`, {
    method: 'POST',
    body: formData,
  });

  await assertApiResponse(response);

  const data = (await response.json()) as { asset: ProjectAsset; project: Project };
  return data;
}

export async function deleteProjectImage(projectId: string, assetId: string) {
  const response = await fetch(`/api/projects/${projectId}/assets/${assetId}`, {
    method: 'DELETE',
  });

  await assertApiResponse(response);

  const data = (await response.json()) as { project: Project };
  return data.project;
}

export async function getProject(id: string) {
  const response = await fetch(`/api/projects/${id}`);
  await assertApiResponse(response);

  const data = (await response.json()) as { project: Project };
  return data.project;
}

export async function reviewProject(id: string) {
  const response = await fetch(`/api/projects/${id}/analyze`, {
    method: 'POST',
  });

  await assertApiResponse(response);

  const data = (await response.json()) as { project: Project };
  return data.project;
}

export async function approveReadyCompositions(id: string) {
  const response = await fetch(`/api/projects/${id}/approve-ready`, {
    method: 'POST',
  });

  await assertApiResponse(response);

  const data = (await response.json()) as { project: Project; approvedCount: number };
  return data;
}

export async function saveComposition(composition: Composition) {
  const response = await fetch(`/api/compositions/${composition.id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      composition,
      expectedRevision: composition.revision,
    }),
  });

  await assertApiResponse(response);

  const data = (await response.json()) as { composition: Composition; project: Project };
  return data;
}

export async function approveComposition(composition: Composition) {
  const response = await fetch(`/api/compositions/${composition.id}/approve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ expectedRevision: composition.revision }),
  });

  await assertApiResponse(response);

  const data = (await response.json()) as { composition: Composition; project: Project };
  return data;
}

export async function duplicateComposition(id: string) {
  const response = await fetch(`/api/compositions/${id}/duplicate`, {
    method: 'POST',
  });

  await assertApiResponse(response);

  const data = (await response.json()) as { composition: Composition; project: Project };
  return data;
}
