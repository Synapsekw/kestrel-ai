import { useCallback, useMemo, type ComponentType } from "react";
import { useShallow } from "zustand/react/shallow";
import { GlassPanel } from "@/ui";
import { useStageSize } from "../compare/stageSize";
import { useWorkspace } from "../context";
import { useRasterLayers } from "../data/useRasterLayers";
import { useGoneLayers } from "../layers/goneLayers";
import { baseMapRows } from "../layers/rasterRows";
import type { PanelProps } from "../panels/panelRegistry";
import type { Coord } from "../types";
import { MinimapCanvas } from "./MinimapCanvas";
import { pickMinimapRow, siteExtentOf, viewportRing } from "./minimapModel";

/** M §5 Minimap: 172 × 110, "Site overview", the right ortho and the viewport; click or drag recentres. */
function MinimapPanel({ projectId, frame }: PanelProps) {
  const layers = useRasterLayers();
  const { r, order, mode, viewInfo, viewApi } = useWorkspace(
    useShallow((s) => ({
      r: s.r,
      order: s.order.base,
      mode: s.mode,
      viewInfo: s.viewInfo,
      viewApi: s.viewApi,
    })),
  );
  const size = useStageSize((s) => s.size);
  const gone = useGoneLayers((s) => s.gone);
  const ortho = useMemo(
    () => pickMinimapRow(baseMapRows({ layers: layers ?? [] }), order, r, gone),
    [layers, order, r, gone],
  );
  const extent = useMemo(() => siteExtentOf(layers ?? []), [layers]);
  // The stage size is the whole stage; in Side-by-side each map is one half of it.
  const paneW = size ? (mode === "side" ? size[0] / 2 : size[0]) : null;
  const paneH = size ? size[1] : null;
  const ring = useMemo(
    () => (viewInfo && paneW !== null && paneH !== null ? viewportRing(viewInfo, [paneW, paneH]) : null),
    [viewInfo, paneW, paneH],
  );
  // Instant for click and drag alike: an animation per pointer move makes the drag lag (M-W2 hand-off).
  const onRecentre = useCallback((c: Coord) => viewApi?.centreOn(c, undefined, { instant: true }), [viewApi]);

  // Nothing in this frame has a footprint: no overview to show, so no empty glass box either.
  if (!extent) return null;
  return (
    <GlassPanel
      variant="float"
      radius="panel"
      data-testid="minimap"
      className="relative h-[110px] w-[172px] overflow-hidden"
    >
      <MinimapCanvas
        frame={frame}
        projectId={projectId}
        ortho={ortho}
        extent={extent}
        ring={ring}
        onRecentre={onRecentre}
      />
      <span className="pointer-events-none absolute bottom-1.5 left-2 rounded-chip bg-glass-solid px-1.5 py-0.5 text-2xs text-ink">
        Site overview
      </span>
    </GlassPanel>
  );
}

export const Minimap: ComponentType<PanelProps> = MinimapPanel;
