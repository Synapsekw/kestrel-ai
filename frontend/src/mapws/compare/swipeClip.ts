import { getRenderPixel } from "ol/render";
import type RenderEvent from "ol/render/Event";

export const SWIPE_MIN = 2;
export const SWIPE_MAX = 98;

export type ClipSide = "left" | "right";

/** The divider position in percent, kept between 2 and 98 (M §5). */
export function clampSwipe(pct: number): number {
  if (!Number.isFinite(pct)) return 50;
  return Math.min(SWIPE_MAX, Math.max(SWIPE_MIN, pct));
}

/** The part of a `[width, height]` map one side shows, in CSS pixels: `[x0, y0, x1, y1]`. */
export function swipeClipRect(
  size: readonly [number, number],
  pct: number,
  side: ClipSide,
): [number, number, number, number] {
  const [w, h] = size;
  const x = Math.round((w * clampSwipe(pct)) / 100);
  return side === "left" ? [0, 0, x, h] : [x, 0, w, h];
}

export function swipeFromPointer(
  clientX: number,
  left: number,
  width: number,
): number {
  if (width <= 0) return 50;
  return clampSwipe(((clientX - left) / width) * 100);
}

/** The slice of `ol/layer/Layer` the clip needs (a fake in tests). */
export interface ClipLayer {
  on(
    type: "prerender" | "postrender",
    listener: (e: RenderEvent) => void,
  ): unknown;
  un(
    type: "prerender" | "postrender",
    listener: (e: RenderEvent) => void,
  ): void;
}

/**
 * Clips a canvas tile layer to one side of the swipe divider (M7, ruling W2-1). The divider is read at
 * render time through `getPct`, so a drag only needs `map.render()`, never a new layer.
 * `getRenderPixel` maps CSS pixels to canvas pixels, which covers the pixel ratio and view rotation.
 */
export function attachSwipeClip(
  layer: ClipLayer,
  side: ClipSide,
  getPct: () => number,
): () => void {
  // Tracks the exact context `save()` was called on, not a bare boolean: a render pass whose
  // `prerender` bails out early (no context/size) must never let `postrender` restore a save that
  // belongs to a *different*, still-pending render pass.
  let savedCtx: CanvasRenderingContext2D | null = null;
  const pre = (e: RenderEvent) => {
    const ctx = e.context as CanvasRenderingContext2D | undefined;
    const size = e.frameState?.size;
    if (!ctx || !size) return;
    const [x0, y0, x1, y1] = swipeClipRect([size[0], size[1]], getPct(), side);
    const pts = [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ].map((p) => getRenderPixel(e, p));
    ctx.save();
    savedCtx = ctx;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
    ctx.closePath();
    ctx.clip();
  };
  const post = (e: RenderEvent) => {
    const ctx = e.context as CanvasRenderingContext2D | undefined;
    if (!ctx || ctx !== savedCtx) return;
    savedCtx = null;
    ctx.restore();
  };
  layer.on("prerender", pre);
  layer.on("postrender", post);
  return () => {
    layer.un("prerender", pre);
    layer.un("postrender", post);
  };
}
