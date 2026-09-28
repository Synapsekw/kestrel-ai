import { useEffect, useRef, type RefObject } from "react";
import { GlassPanel } from "@/ui";
import type { CloudViewerHandle } from "../CloudViewer";
import type { MPoint } from "../measure";
import type { Headline } from "./measureView";

/**
 * The mockup's `.mlabel`: one glass pill at the measurement in W1's `layer` host, moved by direct DOM
 * writes from the viewer's frame hook (spec C5), never by a React render per frame. Hidden when the
 * anchor is behind the camera.
 */
export function MeasureLabel({
  viewer,
  anchor,
  text,
}: {
  viewer: RefObject<CloudViewerHandle | null>;
  anchor: MPoint | null;
  text: Headline | null;
}) {
  const pill = useRef<HTMLDivElement>(null);
  const shown = anchor !== null && text !== null;
  useEffect(() => {
    const v = viewer.current;
    const node = pill.current;
    if (!v || !node || !anchor || !shown) return;
    const place = (origin: { left: number; top: number } | null) => {
      const p = v.project(anchor);
      if (!p || !origin) {
        node.style.visibility = "hidden";
        return;
      }
      node.style.visibility = "visible";
      node.style.transform = `translate3d(${p.x - origin.left}px, ${p.y - origin.top}px, 0) translate(-50%, -140%)`;
    };
    place(v.canvasRect());
    return v.onFrame((cam) => place(cam.rect));
  }, [viewer, anchor, shown]);
  if (!anchor || !text) return null;
  return (
    <GlassPanel
      ref={pill}
      variant="float"
      radius="control"
      aria-hidden="true"
      data-testid="measure-label"
      className="invisible absolute left-0 top-0 whitespace-nowrap px-2.5 py-1 font-mono text-xs text-ink"
    >
      <b className="font-semibold text-ok">{text.primary}</b>
      {text.secondary ? ` · ${text.secondary}` : ""}
    </GlassPanel>
  );
}
