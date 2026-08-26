export type ClipStatus = 'suggested' | 'editing' | 'approved' | 'exporting' | 'completed' | 'error';

export type CropMode = 'cover' | 'contain' | 'custom';
export type CanvasPreset = 'vertical' | 'portrait' | 'square' | 'landscape' | 'classic' | 'custom';

export type Canvas = {
  width: number;
  height: number;
  fps: number;
};

export type Transform = {
  x: number;
  y: number;
  scale: number;
  cropMode: CropMode;
  rotation?: number;
};

export type TrackItem = {
  id: string;
  assetId: string;
  sourceInMs: number;
  sourceOutMs: number;
  timelineStartMs: number;
  regionId: string;
  transform: Transform;
};

export type Track = {
  id: string;
  kind: 'video' | 'audio' | 'caption' | 'media';
  items: TrackItem[];
};

export type Region = {
  id: string;
  name: string;
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
  visible: boolean;
};

export type LayoutDefinition = {
  id: string;
  name: string;
  preset?: CanvasPreset;
  background?: string;
  showSafeArea?: boolean;
  regions: Region[];
};

export type CaptionWord = {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  confidence?: number;
  speakerId?: string;
};

export type CaptionPlacement = {
  regionId?: string;
  anchor: 'top-left' | 'top' | 'top-right' | 'center' | 'bottom-left' | 'bottom' | 'bottom-right' | 'custom';
  xPct: number;
  yPct: number;
  maxWidthPct: number;
  safeArea: boolean;
};

export type CaptionTrack = {
  id: string;
  words: CaptionWord[];
  placement: CaptionPlacement;
};

export type Composition = {
  version: 1;
  id: string;
  projectId: string;
  clipId: string;
  title: string;
  canvas: Canvas;
  durationMs: number;
  tracks: Track[];
  captionTrack?: CaptionTrack;
  layout: LayoutDefinition;
  aiMetadata?: {
    model?: string;
    confidence?: number;
    reasons: string[];
  };
  status: ClipStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type ProjectAsset = {
  id: string;
  type: 'video' | 'image';
  name: string;
  url: string;
  durationSeconds?: number;
};

export type Project = {
  version: 1;
  id: string;
  title: string;
  sourceVideoId: string;
  sourceName: string;
  assets: ProjectAsset[];
  compositions: Composition[];
  createdAt: string;
  updatedAt: string;
};

export type ProjectSummary = Pick<Project, 'id' | 'title' | 'sourceVideoId' | 'sourceName' | 'createdAt' | 'updatedAt'> & {
  compositionCount: number;
  firstCompositionId?: string;
  statuses: Record<ClipStatus, number>;
};
