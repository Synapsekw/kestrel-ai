/* eslint-disable react-refresh/only-export-components --
   makeTileGrid is a pure helper exported next to the component that uses it, so a pinning test can
   build the identical grid; not a fast-refresh boundary. */
import { useEffect, useRef } from "react";
import OlMap from "ol/Map";
import View from "ol/View";
import TileLayer from "ol/layer/Tile";
import TileImage from "ol/source/TileImage";
import TileGrid from "ol/tilegrid/TileGrid";
import Projection from "ol/proj/Projection";
import type { GeoMap } from "@contract/client";
import { fromOl, olExtent, resolutions, TILE, type Extent } from "./grid";

const OVERZOOM = [0.5, 0.25]; // past full resolution: pixels get bigger, never blurrier than the source

/**
 * The tile grid the backend serves: 256 px tiles in the map's own pixel space (`olExtent`), origin
 * at the top-left (`toOl`'s y flip), one tile pixel covering `2^(maxZoom - z)` map pixels at zoom
 * `z` (`resolutions`). Exported so `MapView.tileGrid.test.ts` can pin this exact convention against
 * `ol`'s own tile-coordinate math without a canvas, instead of re-deriving it independently.
 */
export function makeTileGrid(geoMap: Pick<GeoMap, "width" | "height" | "tile_grid">): TileGrid {
  return new TileGrid({
    extent: olExtent(geoMap),
    origin: [0, 0],
    resolutions: resolutions(geoMap.tile_grid.max_zoom),
    tileSize: TILE,
  });
}

export interface MapViewProps {
  geoMap: GeoMap;
  /** `mapTileUrl(...)`: a template with `{z}`, `{x}` and `{y}`. */
  tileUrl: string;
  onReady?: (map: OlMap | null) => void;
  onPointer?: (px: number, py: number) => void;
  onViewChange?: (v: { extent: Extent; resolution: number }) => void;
}

/**
 * The map's own pixel grid in OpenLayers: no reprojection on screen, so boxes stay in the same
 * pixels the backend stores. Only the base tiles live here; run, label, zone and score layers are
 * added to the `ol/Map` handed to `onReady` by the hooks that own them.
 */
export function MapView({ geoMap, tileUrl, onReady, onPointer, onViewChange }: MapViewProps) {
  const target = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onReady, onPointer, onViewChange });
  useEffect(() => {
    callbacks.current = { onReady, onPointer, onViewChange };
  });

  useEffect(() => {
    if (!target.current) return;
    const extent = olExtent(geoMap);
    const projection = new Projection({ code: `kestrel-map-${geoMap.id}`, units: "pixels", extent });
    const res = resolutions(geoMap.tile_grid.max_zoom);
    const source = new TileImage({
      projection,
      tileGrid: makeTileGrid(geoMap),
      tileUrlFunction: (c) =>
        c
          ? tileUrl.replace("{z}", String(c[0])).replace("{x}", String(c[1])).replace("{y}", String(c[2]))
          : undefined,
      transition: 0,
      interpolate: true,
    });
    const map = new OlMap({
      target: target.current,
      layers: [new TileLayer({ source, preload: 1 })],
      controls: [],
      view: new View({
        projection,
        extent,
        resolutions: [...res, ...OVERZOOM],
        constrainOnlyCenter: true,
        showFullExtent: true,
      }),
    });
    map.getView().fit(extent, { padding: [24, 24, 24, 24] });
    const onMove = (e: { coordinate: number[] }) => callbacks.current.onPointer?.(...fromOl(e.coordinate));
    const onEnd = () => {
      const view = map.getView();
      const resolution = view.getResolution() ?? res[0];
      callbacks.current.onViewChange?.({ extent: view.calculateExtent(map.getSize()) as Extent, resolution });
    };
    map.on("pointermove", onMove);
    map.on("moveend", onEnd);
    callbacks.current.onReady?.(map);
    return () => {
      callbacks.current.onReady?.(null);
      map.setTarget(undefined);
      map.dispose();
    };
  }, [geoMap.id, geoMap.width, geoMap.height, geoMap.tile_grid.max_zoom, tileUrl]);

  return <div ref={target} className="absolute inset-0 bg-bg" data-testid="map-view" />;
}
