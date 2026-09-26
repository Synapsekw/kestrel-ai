import type OlMap from "ol/Map";
import type { GeoMap } from "@contract/client";
import { IconButton } from "@/ui";
import type { Readout } from "./coords";
import { olExtent, scaleBar } from "./grid";

const ZOOM_MS = 180;

export function MapOverlay({
  map,
  geoMap,
  readout,
  resolution,
}: {
  map: OlMap | null;
  geoMap: GeoMap;
  readout: Readout | null;
  resolution: number;
}) {
  const zoom = (delta: number) => {
    const view = map?.getView();
    if (view) view.animate({ zoom: (view.getZoom() ?? 0) + delta, duration: ZOOM_MS });
  };
  const bar = scaleBar(resolution, geoMap.gsd_cm);
  return (
    <>
      <div className="absolute right-3 top-3 flex flex-col gap-1 rounded-md border border-line bg-glass-solid p-1 shadow-float">
        <IconButton icon="plus" label="Zoom in" size="sm" onClick={() => zoom(1)} />
        <IconButton icon="minus" label="Zoom out" size="sm" onClick={() => zoom(-1)} />
        <IconButton
          icon="fit"
          label="Fit the whole map"
          size="sm"
          onClick={() => map?.getView().fit(olExtent(geoMap), { duration: ZOOM_MS })}
        />
      </div>
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-4 border-t border-line bg-glass px-3 py-1.5 text-xs tabular-nums text-muted">
        {bar && (
          <span className="flex items-center gap-2" data-testid="scale-bar">
            <span className="h-1.5 border-x border-b border-ink" style={{ width: bar.px }} />
            <span className="text-ink">{bar.label}</span>
          </span>
        )}
        <span>{readout?.pixel ?? "—"}</span>
        {readout?.native && <span>{readout.native}</span>}
        {readout?.wgs84 && <span className="text-ink">{readout.wgs84}</span>}
        <span className="ml-auto">
          {geoMap.gsd_cm
            ? `${(resolution * geoMap.gsd_cm).toFixed(1)} cm / screen px`
            : `${resolution} px / screen px`}
        </span>
      </div>
    </>
  );
}
