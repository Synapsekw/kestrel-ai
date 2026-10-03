/** Spec §9 Register Gallery: tiles at least 176 px wide, 12 px apart, a 4:3 thumb over a 52 px caption. */
export const GALLERY_MIN_TILE = 176;
export const GALLERY_GAP = 12;
export const GALLERY_CAPTION = 52;
/** jsdom and the first render measure 0. */
export const GALLERY_FALLBACK_WIDTH = 960;

export interface GalleryGeometry {
  cols: number;
  tileW: number;
  thumbH: number;
  rowH: number;
}

export function galleryGeometry(width: number): GalleryGeometry {
  const w = width > 0 ? width : GALLERY_FALLBACK_WIDTH;
  const cols = Math.max(1, Math.floor((w + GALLERY_GAP) / (GALLERY_MIN_TILE + GALLERY_GAP)));
  const tileW = (w - GALLERY_GAP * (cols - 1)) / cols;
  const thumbH = (tileW * 3) / 4;
  return { cols, tileW, thumbH, rowH: thumbH + GALLERY_CAPTION + GALLERY_GAP };
}
