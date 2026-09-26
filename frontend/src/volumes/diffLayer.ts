import { useEffect } from "react";
import type OlMap from "ol/Map";
import TileLayer from "ol/layer/Tile";
import TileImage from "ol/source/TileImage";
import type { Surface } from "@contract/client";
import { makeTileGrid } from "@/maps/MapView";
import { surfaceGrid } from "./model";

/**
 * The cut/fill overlay (spec section 8): the measurement's diff grid rendered by the backend in the
 * top surface's tile grid, blue above the base and red below. `url` is `volumeDiffTileUrl(...)` with
 * `v` = the calculation time, so a recalculation never shows cached tiles; null removes the layer.
 */
export function useDiffLayer(map: OlMap | null, surface: Surface | null, url: string | null): void {
  useEffect(() => {
    if (!map || !surface || !url) return;
    const layer = new TileLayer({
      zIndex: 10,
      source: new TileImage({
        projection: map.getView().getProjection(),
        tileGrid: makeTileGrid(surfaceGrid(surface)),
        tileUrlFunction: (c) =>
          c
            ? url.replace("{z}", String(c[0])).replace("{x}", String(c[1])).replace("{y}", String(c[2]))
            : undefined,
        transition: 0,
      }),
    });
    map.addLayer(layer);
    return () => {
      map.removeLayer(layer);
    };
  }, [map, surface, url]);
}
