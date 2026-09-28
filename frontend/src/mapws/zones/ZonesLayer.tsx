import { useEffect, useMemo, useRef } from "react";
import Feature from "ol/Feature";
import type { FeatureLike } from "ol/Feature";
import Polygon from "ol/geom/Polygon";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Fill, Stroke, Style, Text } from "ol/style";
import { useApi } from "@/api/client";
import { isNotImplemented, messageOf } from "@/api/errors";
import { listSiteAreasInFrame, type SiteArea } from "@/api/siteAreas";
import { tokenColour } from "@/maps/styles";
import { toast } from "@/ui";
import { SELECTION_PROP, useMapPane, useWorkspace, type LayerMountProps } from "@/mapws/annotations/bindings";
import { closeRing } from "@/mapws/annotations/planar";
import { categoryOf, zoneFilters, zoneLabel, zoneStyleKind } from "./categories";
import { useZonesStore } from "./store";

const FONT = "600 12px 'Space Grotesk Variable', 'Segoe UI', sans-serif";

/** Diagonal warn hatching for exclusions (spec §9.4); a flat warn tint where canvas is unavailable. */
function hatch(): CanvasPattern | string {
  const canvas = document.createElement("canvas");
  canvas.width = 8;
  canvas.height = 8;
  const ctx = canvas.getContext("2d");
  if (!ctx) return tokenColour("warn", 0.12);
  ctx.strokeStyle = tokenColour("warn", 0.55);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, 8);
  ctx.lineTo(8, 0);
  ctx.stroke();
  return ctx.createPattern(canvas, "repeat") ?? tokenColour("warn", 0.12);
}

function makeStyle(): (f: FeatureLike) => Style {
  const pattern = hatch();
  return (f) => {
    const selected = f.get("selected") === true;
    const hatched = f.get("styleKind") === "hatched-warn";
    const colour = hatched ? tokenColour("warn") : tokenColour(selected ? "accent-ink" : "accent");
    return new Style({
      stroke: new Stroke({
        color: colour,
        width: selected ? 3 : 2,
        lineDash: hatched ? undefined : [8, 5],
      }),
      fill: new Fill({ color: hatched ? pattern : tokenColour("accent", 0.05) }),
      text: new Text({
        text: String(f.get("label") ?? ""),
        font: FONT,
        fill: new Fill({ color: hatched ? tokenColour("warn") : tokenColour("tip-fg") }),
        stroke: new Stroke({ color: tokenColour("tip", 0.85), width: 3 }),
        overflow: true,
      }),
    });
  };
}

function toFeature(a: SiteArea, selected: boolean): Feature | null {
  if (!a.polygon_site || a.polygon_site.length < 3) return null;
  const f = new Feature(new Polygon([closeRing(a.polygon_site)]));
  f.setId(a.id);
  f.set(SELECTION_PROP, { kind: "zone", id: a.id });
  f.setProperties({
    label: zoneLabel(a),
    styleKind: zoneStyleKind(categoryOf(a)),
    selected,
  });
  return f;
}

/** The Site areas & zones annotation layer (spec §9.4, W3-1). */
export function ZonesLayer({ map, zIndex, opacity, style, projectId, frame }: LayerMountProps) {
  const api = useApi();
  const { side } = useMapPane();
  const items = useZonesStore((s) => s.items);
  const revision = useZonesStore((s) => s.revision);
  const categories = useMemo(() => zoneFilters(style).categories, [style]);
  const selection = useWorkspace((s) => s.selection);
  const selId = selection?.kind === "zone" ? selection.id : null;
  const layerRef = useRef<VectorLayer | null>(null);
  const local = frame.kind === "local";
  const frameKey = `${frame.kind}:${frame.epsg ?? ""}:${frame.proj4 ?? ""}`;

  // One `GET /site-areas?frame=site` per revision or frame; Side-by-side's left map reads the store.
  useEffect(() => {
    if (side === "left") return;
    if (local) {
      useZonesStore.getState().set([]);
      return;
    }
    let live = true;
    listSiteAreasInFrame(api, projectId)
      .then((areas) => {
        if (live) useZonesStore.getState().set(areas);
      })
      .catch((e: unknown) => {
        if (live && !isNotImplemented(e)) toast("danger", messageOf(e, "could not load the zones"));
      });
    return () => {
      live = false;
    };
  }, [api, projectId, side, local, frameKey, revision]);

  useEffect(() => {
    const layer = new VectorLayer({ source: new VectorSource(), zIndex, style: makeStyle() });
    map.addLayer(layer);
    layerRef.current = layer;
    return () => {
      map.removeLayer(layer);
      layerRef.current = null;
    };
  }, [map, zIndex]);

  useEffect(() => {
    layerRef.current?.setOpacity(opacity);
  }, [opacity, map, zIndex]);

  // `map`/`zIndex` rebuild the layer above, so they refill it too. A local frame draws nothing.
  useEffect(() => {
    const source = layerRef.current?.getSource();
    if (!source) return;
    source.clear();
    if (local) return;
    source.addFeatures(
      items
        .filter((a) => categories.includes(categoryOf(a)))
        .map((a) => toFeature(a, a.id === selId))
        .filter((f): f is Feature => f !== null),
    );
  }, [items, categories, selId, local, map, zIndex]);

  return null;
}
