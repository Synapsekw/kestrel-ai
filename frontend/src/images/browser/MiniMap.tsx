import { IconButton, Pill } from "@/ui";
import { NO_WEBGL } from "./CaptureMap";
import { useCaptureMap } from "./useCaptureMap";
import type { ImageIndexState } from "./useImageIndex";
import "./browser.css";

export const MINI_MAP_HEIGHT = 168;

export interface MiniMapProps {
  projectId: string;
  index: ImageIndexState;
  currentId: string | null;
  onOpen: (id: string) => void;
  /** ⤢: switch the pane to Map mode (FW). */
  onExpand: () => void;
}

/** Spec §6.1: the 168 px map at the foot of grid mode. Click opens; no pan, zoom or lasso. */
export function MiniMap(p: MiniMapProps) {
  // Destructured at the call site: see CaptureMap.tsx for why.
  const { targetRef, webgl, points } = useCaptureMap({
    projectId: p.projectId,
    index: p.index,
    currentId: p.currentId,
    interactive: false,
    onOpen: p.onOpen,
  });
  return (
    <div
      className="relative shrink-0 overflow-hidden rounded-panel border border-line bg-bg"
      style={{ height: MINI_MAP_HEIGHT }}
      data-testid="mini-map"
    >
      {webgl ? (
        <div ref={targetRef} className="absolute inset-0" />
      ) : (
        <p className="p-3 text-2xs text-muted">{NO_WEBGL}</p>
      )}
      <div className="absolute left-2 right-2 top-2 z-[2] flex items-center gap-1.5">
        <Pill size="sm">{`GPS · EXIF · ${points.length} pts`}</Pill>
        <IconButton
          icon="fit"
          label="Open the capture map"
          size="sm"
          className="ml-auto"
          onClick={p.onExpand}
        />
      </div>
    </div>
  );
}
