import { useEffect, useRef } from "react";
import proj4 from "proj4";
import type OlMap from "ol/Map";
import Feature from "ol/Feature";
import Polygon from "ol/geom/Polygon";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import Draw from "ol/interaction/Draw";
import { Fill, Stroke, Style, Text } from "ol/style";
import type { FeatureLike } from "ol/Feature";
import type { GeoMap } from "@contract/client";
import type { SiteArea } from "@/api/siteAreas";
import { fromOl, toOl } from "./grid";
import { tokenColour } from "./styles";

type Georef = Pick<GeoMap, "geotransform" | "proj4">;

/**
 * WGS84 to this map's pixels: the map's projection (proj4) inverted, then the GDAL geotransform
 * inverted, rotation terms included. Null when the map has no georeference to invert.
 */
export function wgs84ToPixel(m: Georef): ((lon: number, lat: number) => [number, number]) | null {
  const gt = m.geotransform;
  if (!gt || !m.proj4) return null;
  const det = gt[1] * gt[5] - gt[2] * gt[4];
  if (!det) return null;
  const toNative = proj4(m.proj4, "EPSG:4326");
  return (lon, lat) => {
    const [x, y] = toNative.inverse([lon, lat]) as [number, number];
    const dx = x - gt[0];
    const dy = y - gt[3];
    return [(gt[5] * dx - gt[2] * dy) / det, (-gt[4] * dx + gt[1] * dy) / det];
  };
}

/** A site area's outline in map pixels, or null when the map cannot place it. */
export function areaToPixels(m: Georef, polygon: number[][]): [number, number][] | null {
  const project = wgs84ToPixel(m);
  if (!project) return null;
  const ring = polygon.map(([lon, lat]) => project(lon, lat));
  return ring.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)) ? ring : null;
}

export interface SiteAreaLayerOptions {
  areas: SiteArea[];
  /** A polygon drawing tool is active; each finished outline goes to `onDrawn` in map pixels. */
  drawing: boolean;
  onDrawn: (polygonPx: number[][]) => void;
}

/**
 * Project site areas on the map viewer: named outlines, projected from WGS84 onto this map, and a
 * polygon tool for outlining a new one. Drawn in both the normal and the review mode of the viewer.
 */
export function useSiteAreaLayer(map: OlMap | null, geoMap: GeoMap | null, opts: SiteAreaLayerOptions): void {
  const o = useRef(opts);
  const source = useRef<VectorSource | null>(null);
  useEffect(() => {
    o.current = opts;
  });

  useEffect(() => {
    if (!map) return;
    const areas = new VectorSource();
    const layer = new VectorLayer({
      source: areas,
      zIndex: 6,
      style: (f: FeatureLike) =>
        new Style({
          stroke: new Stroke({ color: tokenColour("accent-ink"), width: 2 }),
          fill: new Fill({ color: tokenColour("accent-ink", 0.05) }),
          text: new Text({
            text: String(f.get("name") ?? ""),
            font: "600 12px 'Instrument Sans Variable', 'Segoe UI', sans-serif",
            fill: new Fill({ color: tokenColour("inverse-fg") }),
            stroke: new Stroke({ color: tokenColour("inverse", 0.85), width: 3 }),
            overflow: true,
          }),
        }),
    });
    map.addLayer(layer);
    source.current = areas;
    return () => {
      map.removeLayer(layer);
      source.current = null;
    };
  }, [map]);

  useEffect(() => {
    const s = source.current;
    if (!s) return;
    s.clear();
    if (!geoMap) return;
    for (const area of opts.areas) {
      const ring = areaToPixels(geoMap, area.polygon_wgs84);
      if (!ring) continue;
      const f = new Feature(
        new Polygon([[...ring.map(([x, y]) => toOl(x, y)), toOl(ring[0][0], ring[0][1])]]),
      );
      f.setId(area.id);
      f.set("name", area.name);
      s.addFeature(f);
    }
  }, [opts.areas, geoMap, map]);

  useEffect(() => {
    if (!map || !opts.drawing) return;
    const draw = new Draw({ source: new VectorSource(), type: "Polygon" });
    draw.on("drawend", (e) => {
      const ring = (e.feature.getGeometry() as Polygon).getCoordinates()[0].slice(0, -1);
      o.current.onDrawn(ring.map((c) => fromOl(c).map((v) => Math.round(v * 10) / 10)));
    });
    map.addInteraction(draw);
    return () => {
      map.removeInteraction(draw);
    };
  }, [map, opts.drawing]);
}
