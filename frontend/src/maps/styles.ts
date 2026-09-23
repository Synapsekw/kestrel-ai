/**
 * OpenLayers draws on a canvas, which cannot use Tailwind classes; it reads the same design tokens
 * (`--ok: 174 209 177` in index.css) so the map follows the theme like the rest of the app.
 */
export function tokenColour(name: string, alpha = 1): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
  const [r, g, b] = raw.split(/\s+/).map(Number);
  return Number.isFinite(r) ? `rgba(${r}, ${g}, ${b}, ${alpha})` : `rgba(128, 128, 128, ${alpha})`;
}

/** A class colour (project hex) with alpha, for fills. */
export function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
