import { useEffect, useRef } from "react";
import type OlMap from "ol/Map";
import Feature from "ol/Feature";
import Polygon from "ol/geom/Polygon";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import Draw, { createBox } from "ol/interaction/Draw";
import Modify from "ol/interaction/Modify";
import Select from "ol/interaction/Select";
import Translate from "ol/interaction/Translate";
import { click } from "ol/events/condition";
import { Fill, Stroke, Style } from "ol/style";
import type { FeatureLike } from "ol/Feature";
import type { GeoMap, MapLabel, MapZone } from "@contract/client";
import { boxRing, fromOl, toOl, type Extent } from "./grid";
import { boxFromExtent, type Box } from "./labelModel";
import type { Match } from "./runLayer";
import { tokenColour } from "./styles";

export type Tool = "pan" | "zone-rect" | "zone-poly" | "box";

export interface LabelLayerOptions {
  labels: MapLabel[];
  zones: MapZone[];
  colours: Record<string, string>;
  tool: Tool;
  selectedId: string | null;
  warnIds: ReadonlySet<string>;
  matchOf?: (id: string) => Match | undefined;
  onBox: (box: Box) => void;
  onZone: (polygon: number[][]) => void;
  onEdit: (id: string, box: Box) => void;
  onSelect: (id: string | null) => void;
}

const MATCH_TOKEN: Record<Match, string> = { tp: "ok", fp: "danger", fn: "warn" };

/**
 * Ground truth on the map: zones (hatched outlines) and labels (solid ink outlines with the class
 * colour inside), plus the drawing and editing interactions for the current tool. Boxes stay
 * rectangles: an edited geometry is snapped back to its extent before it is saved.
 */
export function useLabelLayers(map: OlMap | null, _geoMap: GeoMap, opts: LabelLayerOptions): void {
  const o = useRef(opts);
  const sources = useRef<{ labels: VectorSource; zones: VectorSource } | null>(null);
  useEffect(() => {
    o.current = opts;
  });

  useEffect(() => {
    if (!map) return;
    const labels = new VectorSource();
    const zones = new VectorSource();
    const zoneLayer = new VectorLayer({
      source: zones,
      zIndex: 5,
      style: new Style({
        stroke: new Stroke({ color: tokenColour("accent"), width: 2, lineDash: [10, 6] }),
        fill: new Fill({ color: tokenColour("accent", 0.06) }),
      }),
    });
    const labelLayer = new VectorLayer({
      source: labels,
      zIndex: 20,
      style: (f: FeatureLike) => {
        const id = String(f.getId());
        const match = o.current.matchOf?.(id);
        const selected = id === o.current.selectedId;
        const warn = o.current.warnIds.has(id);
        return [
          new Style({
            stroke: new Stroke({
              color: match ? tokenColour(MATCH_TOKEN[match]) : tokenColour("ink"),
              width: selected ? 3 : 2,
              lineDash: match === "fn" ? [4, 4] : undefined,
            }),
          }),
          new Style({
            stroke: new Stroke({
              color: warn
                ? tokenColour("warn")
                : (o.current.colours[f.get("classId")] ?? tokenColour("accent")),
              width: 1,
            }),
          }),
        ];
      },
    });
    map.addLayer(zoneLayer);
    map.addLayer(labelLayer);
    sources.current = { labels, zones };
    return () => {
      map.removeLayer(zoneLayer);
      map.removeLayer(labelLayer);
      sources.current = null;
    };
  }, [map]);

  // Mirror the data into the sources whenever it changes.
  useEffect(() => {
    const s = sources.current;
    if (!s) return;
    s.labels.clear();
    s.labels.addFeatures(
      opts.labels.map((l) => {
        const f = new Feature(new Polygon([boxRing(l.x, l.y, l.w, l.h)]));
        f.setId(l.id);
        f.set("classId", l.class_id);
        return f;
      }),
    );
    s.zones.clear();
    s.zones.addFeatures(
      opts.zones.map((z) => {
        const f = new Feature(
          new Polygon([[...z.polygon.map(([x, y]) => toOl(x, y)), toOl(z.polygon[0][0], z.polygon[0][1])]]),
        );
        f.setId(z.id);
        return f;
      }),
    );
  }, [opts.labels, opts.zones, map]);

  useEffect(() => {
    sources.current?.labels.changed();
  }, [opts.selectedId, opts.warnIds, opts.matchOf, opts.colours]);

  // Interactions for the current tool.
  useEffect(() => {
    const s = sources.current;
    if (!map || !s) return;
    const added: (Draw | Modify | Select | Translate)[] = [];
    if (opts.tool === "box" || opts.tool === "zone-rect") {
      const draw = new Draw({ source: new VectorSource(), type: "Circle", geometryFunction: createBox() });
      draw.on("drawend", (e) => {
        const box = boxFromExtent(e.feature.getGeometry()!.getExtent() as Extent);
        if (o.current.tool === "box") o.current.onBox(box);
        else
          o.current.onZone([
            [box.x, box.y],
            [box.x + box.w, box.y],
            [box.x + box.w, box.y + box.h],
            [box.x, box.y + box.h],
          ]);
      });
      added.push(draw);
    } else if (opts.tool === "zone-poly") {
      const draw = new Draw({ source: new VectorSource(), type: "Polygon" });
      draw.on("drawend", (e) => {
        const ring = (e.feature.getGeometry() as Polygon).getCoordinates()[0].slice(0, -1);
        o.current.onZone(ring.map((c) => fromOl(c).map(Math.round)));
      });
      added.push(draw);
    } else {
      const select = new Select({ layers: (l) => l.getSource() === s.labels, condition: click, style: null });
      select.on("select", (e) => o.current.onSelect(e.selected[0] ? String(e.selected[0].getId()) : null));
      const features = select.getFeatures();
      const modify = new Modify({ features });
      const translate = new Translate({ features });
      const save = (fs: Feature[]) => {
        for (const f of fs) {
          const box = boxFromExtent(f.getGeometry()!.getExtent() as Extent);
          f.setGeometry(new Polygon([boxRing(box.x, box.y, box.w, box.h)])); // snap back to a rectangle
          o.current.onEdit(String(f.getId()), box);
        }
      };
      modify.on("modifyend", (e) => save(e.features.getArray() as Feature[]));
      translate.on("translateend", (e) => save(e.features.getArray() as Feature[]));
      added.push(select, modify, translate);
    }
    added.forEach((i) => map.addInteraction(i));
    return () => added.forEach((i) => map.removeInteraction(i));
  }, [map, opts.tool]);
}
