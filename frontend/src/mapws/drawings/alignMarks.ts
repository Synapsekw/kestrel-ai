import { useEffect, useRef } from "react";
import Feature from "ol/Feature";
import LineString from "ol/geom/LineString";
import Point from "ol/geom/Point";
import Polygon from "ol/geom/Polygon";
import VectorLayer from "ol/layer/Vector";
import type OlMap from "ol/Map";
import VectorSource from "ol/source/Vector";
import { Circle, Fill, Stroke, Style, Text } from "ol/style";
import { tokenColour } from "@/maps/styles";
import { overlayMarks, quadOf, type AlignSession, type OverlayMark } from "../georef/alignModel";
import { PREVIEW_TILES } from "./drawingTiles";

/** Above every workspace layer on its map: the marks are what the operator is clicking against. */
export const MARKS_Z = 100_000;

type Mark = OverlayMark | "outline";

/** R-W5-6: cyan is `tokenColour("ok")`; a map-side bubble (dst) is filled, a drawing-side one hollow. */
function markStyle(m: Mark): Style {
  const cyan = tokenColour("ok");
  if (m === "outline")
    return new Style({
      stroke: new Stroke({ color: cyan, width: 1.5, lineDash: [6, 4] }),
    });
  if (m.kind === "residual")
    return new Style({
      stroke: new Stroke({ color: cyan, width: 1.5, lineDash: [4, 4] }),
    });
  const filled = m.kind === "dst";
  return new Style({
    image: new Circle({
      radius: 9,
      fill: new Fill({ color: filled ? cyan : tokenColour("bg", 0.6) }),
      stroke: new Stroke({ color: cyan, width: 2 }),
    }),
    text: new Text({
      text: String(m.n),
      font: '600 11px "Space Grotesk Variable", system-ui, sans-serif',
      fill: new Fill({ color: filled ? tokenColour("bg") : cyan }),
    }),
  });
}

/**
 * PF9: the K tool's marks — numbered bubbles, dashed residual lines and (without tile preview,
 * R-W5-4) the transformed outline — drawn on `map` by the session drawing's own `DrawingMount`,
 * because W1 renders a tool's Overlay outside the map pane. One layer per map while the session
 * lasts, so Side-by-side shows them on both sides.
 */
export function useAlignMarks(map: OlMap, session: AlignSession | null): void {
  const sourceRef = useRef<VectorSource | null>(null);
  const active = session !== null;

  useEffect(() => {
    if (!active) return;
    const source = new VectorSource();
    const layer = new VectorLayer({
      source,
      zIndex: MARKS_Z,
      style: (f) => markStyle(f.get("mark") as Mark),
    });
    map.addLayer(layer);
    sourceRef.current = source;
    return () => {
      map.removeLayer(layer);
      layer.dispose();
      if (sourceRef.current === source) sourceRef.current = null;
    };
  }, [map, active]);

  // Declared after the build effect, and keyed by `active` too, so a rebuilt layer is refilled.
  useEffect(() => {
    const source = sourceRef.current;
    if (!source || !session) return;
    source.clear();
    const features: Feature[] = overlayMarks(session).map(
      (m) =>
        new Feature({
          geometry: m.coords.length > 1 ? new LineString(m.coords) : new Point(m.coords[0]),
          mark: m,
        }),
    );
    if (!PREVIEW_TILES) {
      const q = quadOf(session.transform, session.extentSrc);
      features.unshift(new Feature({ geometry: new Polygon([[...q, q[0]]]), mark: "outline" }));
    }
    source.addFeatures(features);
  }, [session, map, active]);
}
