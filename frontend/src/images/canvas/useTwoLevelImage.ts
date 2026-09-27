import { useEffect, useState } from "react";
import { pushLog } from "@/app/diagnostics";
import { dur } from "@/ui/motion";
import { bitmapCache, type BitmapCache, type Level } from "./imageCache";

export const PREVIEW_SIDE = 2048;
export const FULL_AFTER_MS = 400;
/** Unpin a frame only after the next image's fade has run, so Konva never draws a closed bitmap. */
const UNPIN_DELAY_MS = dur.fast + 50;

export function wantsFull(scale: number, longSide: number, elapsedMs: number): boolean {
  return longSide > PREVIEW_SIDE && (scale > PREVIEW_SIDE / longSide || elapsedMs >= FULL_AFTER_MS);
}

interface Args {
  imageId: string | null;
  width: number;
  height: number;
  scale: number;
  url: (imageId: string, maxSide: number | null) => string;
  neighbourIds?: readonly string[];
  cache?: BitmapCache;
}

interface Shown {
  imageId: string;
  key: string;
  level: Level;
  bitmap: ImageBitmap;
}

/**
 * Spec §9.1's two-level load: the `max_side=2048` preview first, then the full stored frame once
 * the zoom needs it or 400 ms after navigation. Neighbour previews (≤ 2) are prefetched after the
 * current preview. What is shown is pinned in the cache; a result for an image the canvas has left
 * is cached but never shown.
 */
export function useTwoLevelImage(args: Args): { bitmap: ImageBitmap | null; level: Level | null; imageId: string | null } {
  const { imageId, width, height, scale, url, neighbourIds } = args;
  const cache = args.cache ?? bitmapCache;
  const longSide = Math.max(width, height);
  const single = longSide <= PREVIEW_SIDE;
  const [shown, setShown] = useState<Shown | null>(null);
  const [timerFor, setTimerFor] = useState<string | null>(null);
  const neighbours = (neighbourIds ?? []).slice(0, 2).join(",");

  useEffect(() => {
    if (!imageId) return;
    let live = true;
    const key = `${imageId}:preview`;
    cache
      .load(key, url(imageId, PREVIEW_SIDE), "preview")
      .then((bitmap) => {
        if (!live) return;
        setShown((cur) =>
          cur && cur.imageId === imageId && cur.level === "full" ? cur : { imageId, key, level: single ? "full" : "preview", bitmap },
        );
        for (const id of neighbours ? neighbours.split(",") : []) {
          cache.load(`${id}:preview`, url(id, PREVIEW_SIDE), "preview").catch(() => undefined);
        }
      })
      .catch((e: unknown) => pushLog(`preview failed to load: ${String(e)}`));
    const timer = setTimeout(() => {
      if (live) setTimerFor(imageId);
    }, FULL_AFTER_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // `url` is a new function on most renders; the image id and its size decide what to load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageId, single, neighbours, cache]);

  const needFull = imageId !== null && wantsFull(scale, longSide, timerFor === imageId ? FULL_AFTER_MS : 0);

  useEffect(() => {
    if (!needFull || !imageId) return;
    let live = true;
    const key = `${imageId}:full`;
    cache
      .load(key, url(imageId, null), "full")
      .then((bitmap) => {
        if (live) setShown({ imageId, key, level: "full", bitmap });
      })
      .catch((e: unknown) => pushLog(`full frame failed to load: ${String(e)}`));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needFull, imageId, cache]);

  const shownKey = shown?.key ?? null;
  useEffect(() => {
    if (!shownKey) return;
    cache.pin(shownKey);
    return () => {
      setTimeout(() => cache.unpin(shownKey), UNPIN_DELAY_MS);
    };
  }, [shownKey, cache]);

  if (!shown || shown.imageId !== imageId) return { bitmap: null, level: null, imageId };
  return { bitmap: shown.bitmap, level: shown.level, imageId };
}
