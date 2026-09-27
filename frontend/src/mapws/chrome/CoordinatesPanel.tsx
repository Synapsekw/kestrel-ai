import { useMemo } from "react";
import { GlassPanel, cx, focusRing, stagger } from "@/ui";
import { formatLonLat } from "@/maps/coords";
import { scaleBar } from "@/maps/grid";
import { useWorkspace, useWorkspaceStores } from "../context";
import { PanelSlotHost } from "../panels/PanelSlotHost";
import { toWgs84 } from "../view/siteFrame";

/** Spec §5 Coordinates: CRS chip + scale bar; E and N (or lon/lat); the coords-extra slot (W2's Z). */
export function CoordinatesPanel({ projectId }: { projectId: string }) {
  const { frame } = useWorkspaceStores();
  const pointer = useWorkspace((s) => s.pointer);
  const resolution = useWorkspace((s) => s.viewInfo?.resolution ?? null);
  const wgs84 = useWorkspace((s) => s.wgs84);
  const toggle = useWorkspace((s) => s.toggleWgs84);
  const convert = useMemo(() => toWgs84(frame), [frame]);
  // In site metres, one view unit is one metre: scaleBar's gsd argument of 100 cm makes it metres per pixel.
  const bar = resolution ? scaleBar(resolution, 100) : null;
  const chip = frame.kind === "local" ? "Local metres" : `EPSG:${frame.epsg ?? "?"} · ${frame.name}`;
  const showLonLat = wgs84 && convert !== null;
  return (
    <GlassPanel
      variant="float"
      radius="panel"
      style={stagger(2)}
      className="stagger absolute bottom-4 left-4 z-10 flex min-w-[360px] flex-col gap-1.5 px-3 py-2 animate-rise reduce-motion:animate-none"
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-pressed={showLonLat}
          disabled={convert === null}
          onClick={toggle}
          className={cx(
            "rounded-chip bg-surface-2 px-2 py-0.5 font-mono text-2xs text-muted hover:text-ink disabled:hover:text-muted",
            focusRing,
          )}
        >
          {chip}
        </button>
        {bar && (
          <span
            className="flex items-center gap-1.5 font-mono text-2xs text-muted"
            aria-label={`Scale ${bar.label}`}
          >
            <span className="text-dim">0</span>
            <span className="flex h-1.5" style={{ width: bar.px }}>
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className={cx(
                    "h-full flex-1 border border-line-strong",
                    i % 2 === 0 ? "bg-ink" : "bg-surface",
                  )}
                />
              ))}
            </span>
            <span>{bar.label}</span>
          </span>
        )}
      </div>
      <div className="flex items-center gap-4 font-mono text-xs tabular-nums text-ink">
        {pointer === null ? (
          <span className="text-muted">Move over the map</span>
        ) : showLonLat ? (
          <span>{formatLonLat(...convert!(pointer))}</span>
        ) : (
          <>
            <span>
              <span className="text-muted">E </span>
              <span>{pointer[0].toFixed(2)}</span>
            </span>
            <span>
              <span className="text-muted">N </span>
              <span>{pointer[1].toFixed(2)}</span>
            </span>
          </>
        )}
        <PanelSlotHost slot="coords-extra" projectId={projectId} frame={frame} />
      </div>
    </GlassPanel>
  );
}
