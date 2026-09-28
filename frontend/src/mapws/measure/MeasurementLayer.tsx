import { useEffect, useMemo, useRef } from "react";
import Feature from "ol/Feature";
import type { FeatureLike } from "ol/Feature";
import LineString from "ol/geom/LineString";
import Point from "ol/geom/Point";
import Polygon from "ol/geom/Polygon";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Circle as CircleStyle, Fill, Stroke, Style, Text } from "ol/style";
import type { MapMeasurement } from "@/api/mapMeasurements";
import { tokenColour } from "@/maps/styles";
import { SELECTION_PROP, useMapPane, useWorkspace, type LayerMountProps } from "@/mapws/annotations/bindings";
import { closeRing } from "@/mapws/annotations/planar";
import { hoverIndexAt, hoverPoint, measureFilters } from "./layerFeatures";
import { useProfileHover } from "./profileHover";
import { headline, profileView, siteCoords } from "./results";
import { useMeasurementsStore } from "./store";
import { useMeasurementsLoader } from "./useMeasurementsLoader";

const FONT = "600 12px 'Space Grotesk Variable', 'Segoe UI', sans-serif";

function styleFor(f: FeatureLike): Style {
  const selected = f.get("selected") === true;
  return new Style({
    stroke: new Stroke({
      color: tokenColour(selected ? "accent-ink" : "accent"),
      width: selected ? 3 : 2,
    }),
    fill: new Fill({ color: tokenColour("accent", 0.06) }),
    text: new Text({
      text: String(f.get("label") ?? ""),
      font: FONT,
      fill: new Fill({ color: tokenColour("tip-fg") }),
      stroke: new Stroke({ color: tokenColour("tip", 0.85), width: 3 }),
      overflow: true,
    }),
  });
}

/** A feature in the site frame, or null for a row without `vertices_site` (M-W3 A12). */
function toFeature(m: MapMeasurement, selected: boolean): Feature | null {
  const coords = siteCoords(m);
  if (coords.length === 0) return null;
  const f = new Feature(m.kind === "area" ? new Polygon([closeRing(coords)]) : new LineString(coords));
  f.setId(m.id);
  f.set(SELECTION_PROP, { kind: "measurement", id: m.id });
  f.setProperties({ label: headline(m), selected });
  return f;
}

/** The Measurements annotation layer (W3-1): lines and areas with their headline. */
export function MeasurementLayer({ map, zIndex, opacity, style, projectId, frame }: LayerMountProps) {
  const pane = useMapPane();
  useMeasurementsLoader(projectId, frame, pane.side !== "left");
  const items = useMeasurementsStore((s) => s.items);
  const kinds = useMemo(() => measureFilters(style).kinds, [style]);
  const selection = useWorkspace((s) => s.selection);
  const selId = selection?.kind === "measurement" ? selection.id : null;
  const hoverId = useProfileHover((s) => s.measurementId);
  const hoverIndex = useProfileHover((s) => s.index);
  const layerRef = useRef<VectorLayer | null>(null);
  const markerRef = useRef<Feature<Point> | null>(null);

  useEffect(() => {
    const layer = new VectorLayer({ source: new VectorSource(), zIndex, style: styleFor });
    const marker = new Feature<Point>();
    marker.setStyle(
      new Style({
        image: new CircleStyle({
          radius: 5,
          fill: new Fill({ color: tokenColour("accent") }),
          stroke: new Stroke({ color: tokenColour("tip-fg"), width: 2 }),
        }),
      }),
    );
    const markers = new VectorLayer({
      source: new VectorSource({ features: [marker] }),
      zIndex: zIndex + 0.5,
    });
    map.addLayer(layer);
    map.addLayer(markers);
    layerRef.current = layer;
    markerRef.current = marker;
    return () => {
      map.removeLayer(layer);
      map.removeLayer(markers);
      layerRef.current = null;
      markerRef.current = null;
    };
  }, [map, zIndex]);

  useEffect(() => {
    layerRef.current?.setOpacity(opacity);
  }, [opacity, map, zIndex]);

  // `map`/`zIndex` rebuild the layer above, so they refill it too.
  useEffect(() => {
    const source = layerRef.current?.getSource();
    if (!source) return;
    source.clear();
    const features: Feature[] = [];
    for (const m of items) {
      if (!kinds.includes(m.kind)) continue;
      const f = toFeature(m, m.id === selId);
      if (f) features.push(f);
    }
    source.addFeatures(features);
  }, [items, kinds, selId, map, zIndex]);

  // A14: a listed profile has no stations; the inspector writes the full row into the store, so the
  // hover sync reads that row and stays idle until it has profile data.
  const profile = selId ? (items.find((m) => m.id === selId && m.kind === "profile") ?? null) : null;
  const stations = useMemo(() => {
    const view = profile ? profileView(profile) : null;
    return view?.hasData ? view.stations : null;
  }, [profile]);
  const line = useMemo(() => (profile ? siteCoords(profile) : []), [profile]);
  const profileId = profile && stations && line.length > 0 ? profile.id : null;

  // Chart → map: the marker follows the chart cursor.
  useEffect(() => {
    const marker = markerRef.current;
    if (!marker) return;
    if (!profileId || !stations || hoverId !== profileId || hoverIndex === null) {
      marker.setGeometry(undefined);
      return;
    }
    marker.setGeometry(new Point(hoverPoint(line, stations, hoverIndex)));
  }, [profileId, stations, line, hoverId, hoverIndex, map, zIndex]);

  // Map → chart: hovering the selected profile line moves the chart cursor.
  useEffect(() => {
    if (!profileId || !stations) return;
    const onMove = (e: { pixel: number[]; coordinate: number[] }) => {
      const layer = layerRef.current;
      const hit = layer
        ? map.forEachFeatureAtPixel(e.pixel, (f) => (f.getId() === profileId ? true : undefined), {
            hitTolerance: 6,
            layerFilter: (l) => l === layer,
          })
        : undefined;
      const hover = useProfileHover.getState();
      if (hit) hover.set(profileId, hoverIndexAt(line, stations, e.coordinate));
      else if (hover.measurementId === profileId) hover.set(null, null);
    };
    map.on("pointermove", onMove);
    return () => map.un("pointermove", onMove);
  }, [map, profileId, stations, line]);

  return null;
}
