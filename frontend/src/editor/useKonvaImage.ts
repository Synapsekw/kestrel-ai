import { useEffect, useState } from "react";
import { pushLog } from "@/app/diagnostics";

/**
 * Loads a bitmap for Konva; `null` while loading or when the request fails (the mock serves no
 * real JPEG). The loaded bitmap is keyed by its source, so a new `src` reads as "not loaded"
 * without resetting state inside the effect.
 */
export function useKonvaImage(src: string | null): HTMLImageElement | null {
  const [loaded, setLoaded] = useState<{ src: string; el: HTMLImageElement } | null>(null);
  useEffect(() => {
    if (!src) return;
    let cancelled = false;
    const el = new window.Image();
    el.onload = () => {
      if (!cancelled) setLoaded({ src, el });
    };
    el.onerror = () => {
      if (!cancelled) pushLog(`image failed to load: ${src.replace(/token=[^&]+/, "token=…")}`);
    };
    el.src = src;
    return () => {
      cancelled = true;
    };
  }, [src]);
  return loaded && loaded.src === src ? loaded.el : null;
}
