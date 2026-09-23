import { useEffect, useRef } from "react";
import type OlMap from "ol/Map";
import Feature from "ol/Feature";
import Point from "ol/geom/Point";
import Polygon from "ol/geom/Polygon";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { bbox as bboxStrategy } from "ol/loadingstrategy";
import { Circle, Fill, Stroke, Style } from "ol/style";
import type { FeatureLike } from "ol/Feature";
import type { GeoMap } from "@contract/client";
import type { MapDensity, MapDetectionPage } from "@/api/maps";
import { bboxParam, boxRing, toOl, type Extent } from "./grid";
import { tokenColour, withAlpha } from "./styles";

export type Match = "tp" | "fp" | "fn";

export interface RunLayerSpec {
  runId: string;
  dashed: boolean;
  minConf: number;
  hidden: ReadonlySet<string>;
  colours: Record<string, string>;
  matchOf?: (id: string) => Match | undefined;
  /** Review mode: the detection under review, drawn thicker in the accent colour. */
  selectedId?: string | null;
  load: (bbox: string, minConf: number) => Promise<MapDetectionPage>;
  density: (minConf: number) => Promise<MapDensity>;
  onViewCounts?: (counts: Record<string, number>, truncated: boolean) => void;
}

const MATCH_TOKEN: Record<Match, string> = { tp: "ok", fp: "danger", fn: "warn" };

/** A class colour with alpha, falling back to the live `accent` token (never a hardcoded hex) when
 * the class carries none. */
function classFill(spec: RunLayerSpec, classId: string, alpha: number): string {
  const hex = spec.colours[classId];
  return hex ? withAlpha(hex, alpha) : tokenColour("accent", alpha);
}

function boxStyle(spec: RunLayerSpec, f: FeatureLike): Style | undefined {
  const classId = f.get("classId") as string;
  if (spec.hidden.has(classId)) return undefined;
  if (spec.selectedId && f.getId() === spec.selectedId) {
    return new Style({
      stroke: new Stroke({ color: tokenColour("accent"), width: 3 }),
      fill: new Fill({ color: tokenColour("accent", 0.12) }),
      zIndex: 1,
    });
  }
  // A rejected detection stays visible (it can be un-rejected) but reads as struck out.
  if (f.get("reviewState") === "rejected") {
    return new Style({ stroke: new Stroke({ color: tokenColour("dim"), width: 1.5, lineDash: [2, 4] }) });
  }
  const match = spec.matchOf?.(String(f.getId()));
  const colour = match ? tokenColour(MATCH_TOKEN[match]) : (spec.colours[classId] ?? tokenColour("accent"));
  return new Style({
    stroke: new Stroke({ color: colour, width: 2, lineDash: spec.dashed ? [6, 4] : undefined }),
    fill: new Fill({
      color: match ? tokenColour(MATCH_TOKEN[match], 0.12) : classFill(spec, classId, 0.08),
    }),
  });
}

function dotStyle(spec: RunLayerSpec, f: FeatureLike): Style | undefined {
  const classId = f.get("classId") as string;
  if (spec.hidden.has(classId)) return undefined;
  const n = f.get("count") as number;
  return new Style({
    image: new Circle({
      radius: 3 + Math.sqrt(n) * 2,
      fill: new Fill({ color: classFill(spec, classId, 0.55) }),
      stroke: new Stroke({ color: tokenColour("inverse", 0.6), width: 1 }),
    }),
  });
}

/**
 * One run as two layers: boxes, fetched per view extent (at most 5000 per request), and, when a
 * view holds more than that, density dots for the whole map instead. Nothing is loaded for areas
 * the operator never looks at.
 */
export function useRunLayer(
  map: OlMap | null,
  geoMap: GeoMap,
  spec: RunLayerSpec | null,
): { focus(id: string): void; refresh(): void } {
  const specRef = useRef(spec);
  const layers = useRef<{ boxes: VectorLayer<VectorSource>; dots: VectorLayer<VectorSource> } | null>(null);
  useEffect(() => {
    specRef.current = spec;
    layers.current?.boxes.changed();
    layers.current?.dots.changed();
  });

  const runId = spec?.runId;
  const minConf = spec?.minConf;
  useEffect(() => {
    if (!map || !runId || minConf === undefined) return;
    let truncated = false;
    // Every re-run of this effect (a new `runId`/`minConf` generation) gets its own `stale` flag,
    // flipped in the cleanup below. A viewport request from an earlier generation (say the confidence
    // slider moved from 0.25 to 0.75 while a 0.25 request was still in flight) can resolve after the
    // new generation has already taken over the map; without this guard its late `report()` would
    // overwrite `onViewCounts` with a count for a confidence the operator is no longer looking at,
    // and its late `truncated`/visibility write could flip the layers for a generation it no longer
    // owns. Same pattern as the whole-map counts effect in `MapsScreen.tsx` and the estimate effect
    // in `NewRunDialog.tsx`.
    let stale = false;
    const boxes = new VectorSource({
      strategy: bboxStrategy,
      loader: (extent, _res, _proj, success, failure) => {
        const bbox = bboxParam(extent as Extent, geoMap);
        const s = specRef.current;
        if (!bbox || !s) return success?.([]);
        s.load(bbox, minConf)
          .then((page) => {
            if (stale) return;
            truncated = page.truncated;
            const feats = page.items.map((d) => {
              const f = new Feature(new Polygon([boxRing(d.x, d.y, d.w, d.h)]));
              f.setId(d.id);
              f.setProperties({
                classId: d.class_id,
                confidence: d.confidence,
                kind: "detection",
                reviewState: d.review_state,
                provenanceKind: d.provenance_kind,
              });
              return f;
            });
            boxes.addFeatures(feats);
            boxLayer.setVisible(!truncated);
            dotLayer.setVisible(truncated);
            success?.(feats);
            report();
          })
          .catch(() => {
            if (stale) return;
            boxes.removeLoadedExtent(extent);
            failure?.();
          });
      },
    });
    const dots = new VectorSource();
    const boxLayer = new VectorLayer({
      source: boxes,
      style: (f) => boxStyle(specRef.current!, f),
      zIndex: 10,
    });
    const dotLayer = new VectorLayer({
      source: dots,
      style: (f) => dotStyle(specRef.current!, f),
      zIndex: 11,
      visible: false,
    });
    void specRef.current?.density(minConf).then((d) => {
      if (stale) return;
      dots.addFeatures(
        d.cells.map((c) => {
          const f = new Feature(new Point(toOl((c.gx + 0.5) * d.cell_size, (c.gy + 0.5) * d.cell_size)));
          f.setProperties({ classId: c.class_id, count: c.count });
          return f;
        }),
      );
    });
    function report() {
      if (stale) return;
      const s = specRef.current;
      if (!s?.onViewCounts || !map) return;
      const extent = map.getView().calculateExtent(map.getSize());
      const counts: Record<string, number> = {};
      for (const f of boxes.getFeaturesInExtent(extent)) {
        const c = f.get("classId") as string;
        counts[c] = (counts[c] ?? 0) + 1;
      }
      s.onViewCounts(counts, truncated);
    }
    map.addLayer(boxLayer);
    map.addLayer(dotLayer);
    map.on("moveend", report);
    layers.current = { boxes: boxLayer, dots: dotLayer };
    return () => {
      stale = true;
      map.un("moveend", report);
      map.removeLayer(boxLayer);
      map.removeLayer(dotLayer);
      layers.current = null;
    };
  }, [map, geoMap, runId, minConf]);

  return {
    /** Reload the boxes in view, e.g. after a review write changed their state or added one. */
    refresh() {
      layers.current?.boxes.getSource()?.refresh();
    },
    focus(id: string) {
      const f = layers.current?.boxes.getSource()?.getFeatureById(id);
      const geom = f?.getGeometry();
      if (map && geom)
        map.getView().fit(geom.getExtent(), {
          maxZoom: map.getView().getMaxZoom() - 2,
          duration: 250,
          padding: [80, 80, 80, 80],
        });
    },
  };
}
