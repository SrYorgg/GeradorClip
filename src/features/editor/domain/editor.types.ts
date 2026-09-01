import type { EditorialMetadata } from '../../editorial/domain/editorial.types';

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
  mediaType?: 'video' | 'image';
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

export type LayoutConfig = {
  canvas: Canvas;
  layout: LayoutDefinition;
};

export type CaptionWord = {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  confidence?: number;
  speakerId?: string;
};

export type CaptionCue = {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
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
  cues?: CaptionCue[];
  words?: CaptionWord[];
  placement: CaptionPlacement;
  displayMode?: CaptionDisplayMode;
  language?: CaptionLanguage;
};

export type AnalysisReference = {
  transcriptId?: string;
  visionId?: string;
  speakerId?: string;
};

export type FramingKeyframe = {
  timeMs: number;
  x: number;
  y: number;
  scale: number;
  rotation?: number;
};

export type CaptionMode = 'none' | 'automatic' | 'manual';
export type CaptionPosition = 'top' | 'middle' | 'bottom';
export type CaptionDisplayMode = 'block' | 'word';
export type CaptionLanguage = 'original' | 'pt-BR';
export type CaptionEffect = 'none' | 'karaoke' | 'boxed' | 'neon' | 'shadow';

export type CaptionSettings = {
  mode: CaptionMode;
  manualText?: string;
  corrections?: string;
  font?: string;
  position?: CaptionPosition;
  displayMode?: CaptionDisplayMode;
  effect?: CaptionEffect;
  language?: CaptionLanguage;
  positionX?: number;
  positionY?: number;
  maxWidthPct?: number;
  fontSize?: number;
  textColor?: string;
  highlightColor?: string;
  outlineColor?: string;
  outlineWidth?: number;
  backgroundColor?: string;
  backgroundOpacity?: number;
};

export type CompositionReview = {
  status: 'pending' | 'ready' | 'needs-adjustment';
  issues: string[];
  checkedAt?: string;
};

export type Composition = {
  version: 1 | 2;
  id: string;
  projectId: string;
  clipId: string;
  title: string;
  analysisRef?: AnalysisReference;
  canvas: Canvas;
  durationMs: number;
  tracks: Track[];
  captionTrack?: CaptionTrack;
  captionSettings?: CaptionSettings;
  layout: LayoutDefinition;
  framingTrack?: FramingKeyframe[];
  templateSnapshotId?: string;
  brandKitSnapshotId?: string;
  editorial?: EditorialMetadata;
  aiMetadata?: {
    engine?: string;
    model?: string;
    confidence?: number;
    reasons: string[];
  };
  status: ClipStatus;
  review?: CompositionReview;
  selectedForExport?: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type ProjectAsset = {
  id: string;
  type: 'video' | 'image';
  name: string;
  url: string;
  fileName?: string;
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
  layoutTemplate?: LayoutConfig;
  isLayoutDraft?: boolean;
  generationWarning?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProjectSummary = Pick<Project, 'id' | 'title' | 'sourceVideoId' | 'sourceName' | 'createdAt' | 'updatedAt'> & {
  compositionCount: number;
  firstCompositionId?: string;
  isLayoutDraft?: boolean;
  statuses: Record<ClipStatus, number>;
};
