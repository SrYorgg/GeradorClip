import type { CaptionDisplayMode, CaptionEffect, CaptionSettings } from '../features/editor/domain/editor.types';

export type CaptionStylePreset = {
  id: string;
  label: string;
  description: string;
  font: string;
  displayMode: CaptionDisplayMode;
  effect: CaptionEffect;
  fontSize: number;
  textColor: string;
  highlightColor: string;
  outlineColor: string;
  outlineWidth: number;
  backgroundColor: string;
  backgroundOpacity: number;
};

export const captionStylePresets: CaptionStylePreset[] = [
  {
    id: 'classic',
    label: 'Classic',
    description: 'Legenda equilibrada para qualquer corte',
    font: 'geist',
    displayMode: 'block',
    effect: 'none',
    fontSize: 42,
    textColor: '#FFFFFF',
    highlightColor: '#73DDBD',
    outlineColor: '#111111',
    outlineWidth: 2,
    backgroundColor: '#000000',
    backgroundOpacity: 0.6,
  },
  {
    id: 'impact',
    label: 'Impacto',
    description: 'Palavra a palavra com destaque forte',
    font: 'montserrat',
    displayMode: 'word',
    effect: 'karaoke',
    fontSize: 48,
    textColor: '#FFFFFF',
    highlightColor: '#FFD447',
    outlineColor: '#111111',
    outlineWidth: 3,
    backgroundColor: '#000000',
    backgroundOpacity: 0.45,
  },
  {
    id: 'clean',
    label: 'Clean',
    description: 'Leve, sem caixa de fundo',
    font: 'open-sans',
    displayMode: 'block',
    effect: 'none',
    fontSize: 40,
    textColor: '#FFFFFF',
    highlightColor: '#FFFFFF',
    outlineColor: '#111111',
    outlineWidth: 2,
    backgroundColor: '#000000',
    backgroundOpacity: 0,
  },
  {
    id: 'neon',
    label: 'Neon',
    description: 'Cores vibrantes e sombra luminosa',
    font: 'poppins',
    displayMode: 'word',
    effect: 'neon',
    fontSize: 46,
    textColor: '#FFFFFF',
    highlightColor: '#FF4FD8',
    outlineColor: '#4F46E5',
    outlineWidth: 3,
    backgroundColor: '#111827',
    backgroundOpacity: 0.3,
  },
  {
    id: 'news',
    label: 'News',
    description: 'Compacta para entrevistas e notícias',
    font: 'oswald',
    displayMode: 'block',
    effect: 'boxed',
    fontSize: 40,
    textColor: '#FFFFFF',
    highlightColor: '#73DDBD',
    outlineColor: '#000000',
    outlineWidth: 1,
    backgroundColor: '#000000',
    backgroundOpacity: 0.88,
  },
];

export function getCaptionStylePreset(id?: string | null) {
  return captionStylePresets.find((preset) => preset.id === id) || captionStylePresets[0];
}

export function toCaptionSettings(preset: CaptionStylePreset): Pick<CaptionSettings, 'font' | 'displayMode' | 'effect' | 'fontSize' | 'textColor' | 'highlightColor' | 'outlineColor' | 'outlineWidth' | 'backgroundColor' | 'backgroundOpacity'> {
  return {
    font: preset.font,
    displayMode: preset.displayMode,
    effect: preset.effect,
    fontSize: preset.fontSize,
    textColor: preset.textColor,
    highlightColor: preset.highlightColor,
    outlineColor: preset.outlineColor,
    outlineWidth: preset.outlineWidth,
    backgroundColor: preset.backgroundColor,
    backgroundOpacity: preset.backgroundOpacity,
  };
}
