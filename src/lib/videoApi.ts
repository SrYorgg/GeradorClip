import type { Canvas, Composition, LayoutConfig, Project, ProjectAsset, ProjectSummary } from '../features/editor/domain/editor.types';

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
  subtitleLanguage?: string;
  subtitlePath?: string | null;
  subtitleError?: string | null;
  subtitleSource?: string | null;
  subtitleCorrections?: number;
  audioMode?: string;
};

export type GalleryPackage = {
  id: string;
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
  subtitleCorrections?: number;
  audioMode: string;
  clips: GeneratedClip[];
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
    };
    pyannote?: AiToolResult & {
      turns?: unknown[];
    };
    ollama?: AiToolResult & {
      model?: string;
      response?: string;
    };
  };
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
    mode: 'duration' | 'count';
    targetDurationSeconds: number;
    targetClipCount: number;
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

  const data = (await response.json()) as { video: UploadedVideo; clips: GeneratedClip[] };
  return data;
}

export async function listGalleryPackages() {
  const response = await fetch('/api/gallery');
  await assertApiResponse(response);

  const data = (await response.json()) as { packages: GalleryPackage[] };
  return data.packages;
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
}) {
  const response = await fetch('/api/gallery/export', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  await assertApiResponse(response);

  const data = (await response.json()) as { package: GalleryPackage };
  return data.package;
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
      mode: 'count',
      targetDurationSeconds: 60,
      targetClipCount: 5,
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
