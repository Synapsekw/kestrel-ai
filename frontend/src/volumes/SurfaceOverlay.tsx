import type OlMap from "ol/Map";
import type { Surface } from "@contract/client";
import { IconButton } from "@/ui";
import { olExtent, scaleBar } from "@/maps/grid";
import { surfaceGrid } from "./model";

const ZOOM_MS = 180;

export interface SurfaceReadout {
  x: number;
  y: number;
  top: number | null;
  base: number | null;
}

const m = (v: number | null) => (v == null ? "no data" : `${v.toFixed(2)} m`);

/**
 * Zoom buttons and the bottom bar of the surface view (spec section 9): E and N in the surface's
 * CRS, Z of the top, and for a surface base also Z of the base and dZ; the scale bar comes from the
 * cell size, exactly as the maps overlay derives it from the GSD.
 */
export function SurfaceOverlay({
  map,
  surface,
  readout,
  resolution,
}: {
  map: OlMap | null;
  surface: Surface;
  readout: SurfaceReadout | null;
  resolution: number;
}) {
  const zoom = (delta: number) => {
    const view = map?.getView();
    if (view) view.animate({ zoom: (view.getZoom() ?? 0) + delta, duration: ZOOM_MS });
  };
  const bar = scaleBar(resolution, (surface.cell_size_m ?? 0) * 100);
  const dz = readout && readout.top != null && readout.base != null ? readout.top - readout.base : null;
  return (
    <>
      <div className="absolute right-3 top-3 flex flex-col gap-1 rounded-md border border-line bg-panel p-1 shadow-float">
        <IconButton icon="plus" label="Zoom in" size="sm" onClick={() => zoom(1)} />
        <IconButton icon="minus" label="Zoom out" size="sm" onClick={() => zoom(-1)} />
        <IconButton
          icon="fit"
          label="Fit the whole surface"
          size="sm"
          onClick={() => map?.getView().fit(olExtent(surfaceGrid(surface)), { duration: ZOOM_MS })}
        />
      </div>
      <div
        className="absolute inset-x-0 bottom-0 flex items-center gap-4 border-t border-line bg-panel/90 px-3 py-1.5 text-xs tabular-nums text-muted"
        data-testid="surface-readout"
      >
        {bar && (
          <span className="flex items-center gap-2" data-testid="scale-bar">
            <span className="h-1.5 border-x border-b border-ink" style={{ width: bar.px }} />
            <span className="text-ink">{bar.label}</span>
          </span>
        )}
        {readout ? (
          <>
            <span>
              E {readout.x.toFixed(2)} · N {readout.y.toFixed(2)}
              {surface.epsg ? ` · EPSG:${surface.epsg}` : " · local"}
            </span>
            <span className="text-ink">Z {m(readout.top)}</span>
            {readout.base !== undefined && readout.base !== null && <span>base {m(readout.base)}</span>}
            {dz != null && (
              <span className="text-ink">
                dZ {dz >= 0 ? "+" : ""}
                {dz.toFixed(2)} m
              </span>
            )}
          </>
        ) : (
          <span>—</span>
        )}
        <span className="ml-auto">{surface.cell_size_m ? `${surface.cell_size_m} m cells` : ""}</span>
      </div>
    </>
  );
}
