import { useEffect, useRef } from "react";

/** S1's click slop: a pointer that moved further than this between down and up was a drag. */
export const CLICK_SLOP_PX = 4;
/** The viewer's canvas (S1's test id, kept by the workspace, spec §5). */
export const CANVAS_SELECTOR = '[data-testid="cloud-canvas"]';

const onCanvas = (ev: Event): boolean => ev.target instanceof Element && !!ev.target.closest(CANVAS_SELECTOR);

/**
 * Left clicks on the viewer canvas while `enabled`, in client coordinates, whether or not a point is
 * under them (a camera glyph floats above the cloud). `onDown` fires on every left pointer-down.
 *
 * Listens on `document` in the capture phase and keeps only events whose target is inside the
 * canvas (C-L1 Ruling 5): `CloudViewer` re-creates the canvas on "Reload view" (`key={generation}`),
 * so a listener bound once to the element would go dead.
 */
export function useCanvasClicks(
  enabled: boolean,
  onClick: (clientX: number, clientY: number) => void,
  onDown?: () => void,
): void {
  const cb = useRef({ onClick, onDown });
  useEffect(() => {
    cb.current = { onClick, onDown };
  });
  useEffect(() => {
    if (!enabled) return;
    let down: { x: number; y: number } | null = null;
    const onPointerDown = (ev: PointerEvent) => {
      if (ev.button !== 0 || !onCanvas(ev)) return;
      down = { x: ev.clientX, y: ev.clientY };
      cb.current.onDown?.();
    };
    const onPointerUp = (ev: PointerEvent) => {
      const d = down;
      down = null;
      if (!d || ev.button !== 0 || !onCanvas(ev)) return;
      if (Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > CLICK_SLOP_PX) return;
      cb.current.onClick(ev.clientX, ev.clientY);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointerup", onPointerUp, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointerup", onPointerUp, true);
    };
  }, [enabled]);
}
