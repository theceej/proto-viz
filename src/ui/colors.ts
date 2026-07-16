/**
 * Layer color assignment. CVD-validated categorical palette (dataviz skill,
 * dark surface): hues are assigned to layers in this fixed order by stack
 * position. Field identity is never color-alone — every field is direct-
 * labeled and separated by gaps.
 */
const LAYER_PALETTE = ['#0284c7', '#d97706', '#8b5cf6', '#059669', '#f43f5e', '#0d9488'];

export interface LayerColor {
  accent: string; // solid accent (chips, borders)
  fill: string; // translucent field fill
  fillHover: string; // highlighted field fill
  border: string; // field cell border
  tint: string; // very subtle hex-view row tint
}

export function layerColor(index: number): LayerColor {
  const hex = LAYER_PALETTE[index % LAYER_PALETTE.length]!;
  return {
    accent: hex,
    fill: `${hex}2e`,
    fillHover: `${hex}73`,
    border: `${hex}80`,
    tint: `${hex}14`,
  };
}

export const PAYLOAD_COLOR: LayerColor = {
  accent: '#71717a',
  fill: '#71717a2e',
  fillHover: '#71717a73',
  border: '#71717a80',
  tint: '#71717a14',
};
