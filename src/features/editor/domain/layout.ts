import type { Canvas, CanvasPreset, Composition, Region, TrackItem, Transform } from './editor.types';

export type LayoutPresetDefinition = {
  id: CanvasPreset;
  label: string;
  shortLabel: string;
  width: number;
  height: number;
  description: string;
};

export const LAYOUT_PRESETS: LayoutPresetDefinition[] = [
  {
    id: 'vertical',
    label: 'Vertical 9:16',
    shortLabel: '9:16',
    width: 1080,
    height: 1920,
    description: 'Reels, Shorts e TikTok',
  },
  {
    id: 'portrait',
    label: 'Retrato 4:5',
    shortLabel: '4:5',
    width: 1080,
    height: 1350,
    description: 'Feed vertical',
  },
  {
    id: 'square',
    label: 'Quadrado 1:1',
    shortLabel: '1:1',
    width: 1080,
    height: 1080,
    description: 'Feed quadrado',
  },
  {
    id: 'landscape',
    label: 'Paisagem 16:9',
    shortLabel: '16:9',
    width: 1920,
    height: 1080,
    description: 'YouTube e apresentações',
  },
  {
    id: 'classic',
    label: 'Clássico 4:3',
    shortLabel: '4:3',
    width: 1440,
    height: 1080,
    description: 'Vídeo tradicional',
  },
];

export const DEFAULT_TRANSFORM: Transform = {
  x: 0,
  y: 0,
  scale: 1,
  cropMode: 'cover',
  rotation: 0,
};

export const DEFAULT_REGION: Region = {
  id: 'main',
  name: 'Vídeo principal',
  xPct: 0,
  yPct: 0,
  widthPct: 100,
  heightPct: 100,
  visible: true,
};

export function getLayoutPreset(preset?: CanvasPreset) {
  return LAYOUT_PRESETS.find((item) => item.id === preset) || LAYOUT_PRESETS[0];
}

export function getCanvasLabel(canvas: Canvas) {
  return `${canvas.width} × ${canvas.height}`;
}

export function getCompositionRegion(composition: Composition, item: TrackItem | null) {
  return composition.layout.regions.find((region) => region.id === item?.regionId) || composition.layout.regions[0] || DEFAULT_REGION;
}

export function getTransform(item: TrackItem | null) {
  return item?.transform || DEFAULT_TRANSFORM;
}
