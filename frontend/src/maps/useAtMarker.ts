import { useEffect } from "react";
import type OlMap from "ol/Map";
import Overlay from "ol/Overlay";
import type { GeoMap } from "@contract/client";
import { nativeToPixel, type XY } from "@/clouds/jump";
import { toOl } from "./grid";

/** Spec §10 "3D to map": centre on `at` (map native CRS) at full resolution and drop a marker. */
export function useAtMarker(map: OlMap | null, geoMap: GeoMap | null, at: XY | null): { outside: boolean } {
  const pixel = geoMap?.geotransform && at ? nativeToPixel(geoMap.geotransform, at.x, at.y) : null;
  // Primitives, not the pixel tuple: a reload of the map list or another search param (review mode)
  // makes new objects for the same spot, and must not re-centre the view.
  const px = pixel ? pixel[0] : null;
  const py = pixel ? pixel[1] : null;
  const outside =
    px !== null && py !== null && !!geoMap && (px < 0 || py < 0 || px > geoMap.width || py > geoMap.height);
  useEffect(() => {
    if (!map || px === null || py === null || outside) return;
    const el = document.createElement("div");
    el.dataset.testid = "map-at-marker";
    el.className = "h-4 w-4 rounded-full border-2 border-accent bg-accent/30";
    const marker = new Overlay({
      element: el,
      position: toOl(px, py),
      positioning: "center-center",
      stopEvent: false,
    });
    map.addOverlay(marker);
    map.getView().setCenter(toOl(px, py));
    map.getView().setResolution(1); // one map pixel per screen pixel
    return () => {
      map.removeOverlay(marker);
    };
  }, [map, px, py, outside]);
  return { outside };
}
