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
  audioMode?: string;
};

export type GalleryPackage = {
  id: string;
  title: string;
  folderName: string;
  folderUrl: string;
  sourceVideoId: string;
  sourceName: string;
  createdAt: string;
  subtitleMode: string;
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

function assertApiResponse(response: Response) {
  if (!response.ok) {
    throw new Error(`API request failed with status ${response.status}`);
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

  assertApiResponse(response);

  const data = (await response.json()) as { video: UploadedVideo };
  return data.video;
}

export async function listUploadedVideos() {
  const response = await fetch('/api/videos');
  assertApiResponse(response);

  const data = (await response.json()) as { videos: UploadedVideo[] };
  return data.videos;
}

export async function listGeneratedClips() {
  const response = await fetch('/api/clips');
  assertApiResponse(response);

  const data = (await response.json()) as { clips: GeneratedClip[] };
  return data.clips;
}

export async function generateVideoClips(id: string) {
  const response = await fetch(`/api/videos/${id}/clips`, {
    method: 'POST',
  });

  assertApiResponse(response);

  const data = (await response.json()) as { video: UploadedVideo; clips: GeneratedClip[] };
  return data;
}

export async function listGalleryPackages() {
  const response = await fetch('/api/gallery');
  assertApiResponse(response);

  const data = (await response.json()) as { packages: GalleryPackage[] };
  return data.packages;
}

export async function exportClipsToGallery(payload: {
  videoId: string;
  clipIds: string[];
  captionClipIds: string[];
  subtitleMode: string;
  audioMode: string;
}) {
  const response = await fetch('/api/gallery/export', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  assertApiResponse(response);

  const data = (await response.json()) as { package: GalleryPackage };
  return data.package;
}

export async function deleteUploadedVideo(id: string) {
  const response = await fetch(`/api/videos/${id}`, {
    method: 'DELETE',
  });

  assertApiResponse(response);
}

export async function analyzeUploadedVideo(id: string) {
  const response = await fetch(`/api/videos/${id}/analyze`, {
    method: 'POST',
  });

  assertApiResponse(response);

  const data = (await response.json()) as { video: UploadedVideo };
  return data.video;
}

export async function getAiStatus() {
  const response = await fetch('/api/ai/status');
  assertApiResponse(response);

  const data = (await response.json()) as {
    status: Record<string, boolean>;
  };
  return data.status;
}
