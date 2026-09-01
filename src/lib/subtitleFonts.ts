export type SubtitleFont = {
  id: string;
  label: string;
  ffmpegName: string;
  cssFamily: string;
};

export const subtitleFonts: SubtitleFont[] = [
  {
    id: 'geist',
    label: 'Geist (Opus)',
    ffmpegName: 'Geist',
    cssFamily: 'Geist, Arial, sans-serif',
  },
  {
    id: 'komika-axis',
    label: 'Komika Axis (Opus)',
    ffmpegName: 'Komika Axis',
    cssFamily: '"Komika Axis", Anton, Impact, sans-serif',
  },
  {
    id: 'anton',
    label: 'Anton',
    ffmpegName: 'Anton',
    cssFamily: 'Anton, Impact, sans-serif',
  },
  {
    id: 'bebas-neue',
    label: 'Bebas Neue',
    ffmpegName: 'Bebas Neue',
    cssFamily: '"Bebas Neue", Impact, sans-serif',
  },
  {
    id: 'inter',
    label: 'Inter',
    ffmpegName: 'Inter',
    cssFamily: 'Inter, Arial, sans-serif',
  },
  {
    id: 'montserrat',
    label: 'Montserrat',
    ffmpegName: 'Montserrat',
    cssFamily: 'Montserrat, Arial, sans-serif',
  },
  {
    id: 'poppins',
    label: 'Poppins',
    ffmpegName: 'Poppins',
    cssFamily: 'Poppins, Arial, sans-serif',
  },
  {
    id: 'roboto',
    label: 'Roboto',
    ffmpegName: 'Roboto',
    cssFamily: 'Roboto, Arial, sans-serif',
  },
  {
    id: 'open-sans',
    label: 'Open Sans',
    ffmpegName: 'Open Sans',
    cssFamily: '"Open Sans", Arial, sans-serif',
  },
  {
    id: 'lato',
    label: 'Lato',
    ffmpegName: 'Lato',
    cssFamily: 'Lato, Arial, sans-serif',
  },
  {
    id: 'oswald',
    label: 'Oswald',
    ffmpegName: 'Oswald',
    cssFamily: 'Oswald, Arial, sans-serif',
  },
];

export function getSubtitleFont(id: string) {
  return subtitleFonts.find((font) => font.id === id) || subtitleFonts[0];
}
