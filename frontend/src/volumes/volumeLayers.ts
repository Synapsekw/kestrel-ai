import { useEffect, useRef } from "react";
import type OlMap from "ol/Map";
import Feature from "ol/Feature";
import Polygon from "ol/geom/Polygon";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import Draw from "ol/interaction/Draw";
import Modify from "ol/interaction/Modify";
import Select from "ol/interaction/Select";
import { click } from "ol/events/condition";
import { Fill, Stroke, Style } from "ol/style";
import type { FeatureLike } from "ol/Feature";
import { fromOl, toOl } from "@/maps/grid";
import { tokenColour } from "@/maps/styles";
import { nativeToPixel, pixelToNative } from "./model";

export type VolumeTool = "pan" | "measure" | "stable" | "exclusion" | "edit";
export type RingRole = "measure" | "stable" | "exclusion" | "footprint";

export interface VolumeLayerOptions {
  /** The top surface's geotransform: every ring converts through it (north-up). */
  geotransform: number[];
  polygon: number[][] | null;
  stable: number[][] | null;
  exclusions: { id: string; ring: number[][]; mode: "patch" | "exclude" }[];
  footprints: number[][][];
  tool: VolumeTool;
  selectedExclusion: string | null;
  /** A finished ring in native coordinates; `role` says what the tool drew. */
  onDrawn: (role: Exclude<RingRole, "footprint">, ring: number[][]) => void;
  /** A ring edited with the Edit tool; `id` is the exclusion's id for exclusions. */
  onEdited: (role: Exclude<RingRole, "footprint">, ring: number[][], id?: string) => void;
  onSelectExclusion: (id: string | null) => void;
}

function feature(role: RingRole, gt: number[], ring: number[][], id?: string, mode?: string): Feature {
  const px = ring.map(([x, y]) => toOl(...nativeToPixel(gt, x, y)));
  const f = new Feature(new Polygon([[...px, px[0]]]));
  f.setProperties({ role, mode });
  if (id) f.setId(id);
  return f;
}

function nativeRing(f: Feature, gt: number[]): number[][] {
  const coords = (f.getGeometry() as Polygon).getCoordinates()[0].slice(0, -1);
  return coords.map((c) => pixelToNative(gt, ...fromOl(c)));
}

/** Section 9's vector layers, bottom up: footprints (warn), exclusions (danger, dashed for patch,
 * hatched-looking fill for exclude), the stable area (ok, dashed) and the measurement (accent, 2 px). */
function styleFor(f: FeatureLike, selected: string | null): Style {
  const role = f.get("role") as RingRole;
  if (role === "footprint")
    return new Style({
      stroke: new Stroke({ color: tokenColour("warn"), width: 1.5 }),
      fill: new Fill({ color: tokenColour("warn", 0.12) }),
    });
  if (role === "exclusion") {
    const exclude = f.get("mode") === "exclude";
    return new Style({
      stroke: new Stroke({
        color: tokenColour("danger"),
        width: f.getId() === selected ? 3 : 2,
        lineDash: exclude ? undefined : [8, 5],
      }),
      fill: new Fill({ color: tokenColour("danger", exclude ? 0.22 : 0.06) }),
    });
  }
  if (role === "stable")
    return new Style({
      stroke: new Stroke({ color: tokenColour("ok"), width: 2, lineDash: [10, 6] }),
      fill: new Fill({ color: tokenColour("ok", 0.08) }),
    });
  return new Style({
    stroke: new Stroke({ color: tokenColour("accent"), width: 2 }),
    fill: new Fill({ color: tokenColour("accent", 0.04) }),
  });
}

/**
 * The measurement's rings on the surface view, and the drawing tools (spec section 9): Draw
 * measurement (P), Stable area (S), Exclusion (X) draw a polygon; Edit vertices (E) modifies the
 * existing rings and selects an exclusion. Every finished geometry goes out in native coordinates
 * at once; nothing is held unsaved here.
 */
export function useVolumeLayers(map: OlMap | null, opts: VolumeLayerOptions): void {
  const o = useRef(opts);
  const source = useRef<VectorSource | null>(null);
  useEffect(() => {
    o.current = opts;
  });

  useEffect(() => {
    if (!map) return;
    const s = new VectorSource();
    const layer = new VectorLayer({
      source: s,
      zIndex: 20,
      style: (f) => styleFor(f, o.current.selectedExclusion),
    });
    map.addLayer(layer);
    source.current = s;
    return () => {
      map.removeLayer(layer);
      source.current = null;
    };
  }, [map]);

  useEffect(() => {
    const s = source.current;
    if (!s) return;
    const gt = opts.geotransform;
    s.clear();
    s.addFeatures([
      ...opts.footprints.map((ring) => feature("footprint", gt, ring)),
      ...opts.exclusions.map((e) => feature("exclusion", gt, e.ring, e.id, e.mode)),
      ...(opts.stable ? [feature("stable", gt, opts.stable)] : []),
      ...(opts.polygon ? [feature("measure", gt, opts.polygon)] : []),
    ]);
  }, [map, opts.geotransform, opts.polygon, opts.stable, opts.exclusions, opts.footprints]);

  useEffect(() => {
    source.current?.changed();
  }, [opts.selectedExclusion]);

  useEffect(() => {
    const s = source.current;
    if (!map || !s || opts.tool === "pan") return;
    const added: (Draw | Modify | Select)[] = [];
    if (opts.tool === "edit") {
      const select = new Select({
        layers: (l) => l.getSource() === s,
        filter: (f) => f.get("role") !== "footprint",
        condition: click,
        style: null,
      });
      select.on("select", (e) => {
        const f = e.selected[0];
        o.current.onSelectExclusion(f && f.get("role") === "exclusion" ? String(f.getId()) : null);
      });
      const modify = new Modify({ source: s });
      modify.on("modifyend", (e) => {
        for (const f of e.features.getArray() as Feature[]) {
          const role = f.get("role") as RingRole;
          if (role === "footprint") continue;
          o.current.onEdited(
            role,
            nativeRing(f, o.current.geotransform),
            f.getId() ? String(f.getId()) : undefined,
          );
        }
      });
      added.push(select, modify);
    } else {
      const role = opts.tool === "measure" ? "measure" : opts.tool === "stable" ? "stable" : "exclusion";
      const draw = new Draw({ source: new VectorSource(), type: "Polygon" });
      draw.on("drawend", (e) =>
        o.current.onDrawn(role, nativeRing(e.feature as Feature, o.current.geotransform)),
      );
      added.push(draw);
    }
    added.forEach((i) => map.addInteraction(i));
    return () => added.forEach((i) => map.removeInteraction(i));
  }, [map, opts.tool]);
}
