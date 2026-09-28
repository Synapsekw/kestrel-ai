import { useEffect, useMemo, useRef, useState } from "react";
import Feature from "ol/Feature";
import type { FeatureLike } from "ol/Feature";
import Point from "ol/geom/Point";
import Polygon from "ol/geom/Polygon";
import VectorLayer from "ol/layer/Vector";
import { getVectorContext } from "ol/render";
import type RenderEvent from "ol/render/Event";
import VectorSource from "ol/source/Vector";
import { Circle as CircleStyle, Fill, Stroke, Style } from "ol/style";
import type { MapFindingPin } from "@/api/mapFindings";
import { useProjectTypes } from "@/findings/useProjectTypes";
import { tokenColour, withAlpha } from "@/maps/styles";
import { GlassPanel, SeverityPill, severityOf, useSeverityScale } from "@/ui";
import { SELECTION_PROP, useMapPane, useWorkspace, type LayerMountProps } from "@/mapws/annotations/bindings";
import { centroid } from "@/mapws/annotations/planar";
import { pulseFrame, usePulseStore } from "./pulse";
import { useMapFindingsStore } from "./store";
import { findingFilters, tooltipLine, visibleFindings } from "./tooltip";
import { useFindingsInView } from "./useFindingsInView";

const EMPTY: MapFindingPin[] = [];

function styleFor(feature: FeatureLike): Style[] {
  const hex = feature.get("colour") as string | null;
  const top = feature.get("top") === true;
  const selected = feature.get("selected") === true;
  const colour = hex ?? tokenColour("accent");
  const ring = new Stroke({
    color: selected ? tokenColour("accent-ink") : colour,
    width: (top ? 3.5 : 2) + (selected ? 1 : 0),
  });
  if (feature.getGeometry()?.getType() === "Polygon")
    return [
      new Style({
        stroke: ring,
        fill: new Fill({ color: hex ? withAlpha(hex, 0.12) : tokenColour("accent", 0.12) }),
      }),
    ];
  return [
    new Style({ image: new CircleStyle({ radius: 11, stroke: ring }) }),
    new Style({
      image: new CircleStyle({
        radius: 6,
        fill: new Fill({ color: colour }),
        stroke: new Stroke({ color: tokenColour("tip"), width: 2 }),
      }),
    }),
  ];
}

function toFeature(f: MapFindingPin, colour: string | null, top: boolean, selected: boolean): Feature {
  const g = f.geometry_site as { type: string; coordinates: unknown };
  const geometry =
    g.type === "Polygon" ? new Polygon(g.coordinates as number[][][]) : new Point(g.coordinates as number[]);
  const feature = new Feature(geometry);
  feature.setId(f.id);
  feature.set(SELECTION_PROP, { kind: "finding", id: f.id });
  feature.setProperties({ colour, top, selected });
  return feature;
}

/** The Findings annotation layer (spec §9.4, W3-1): pins in severity colour, outlines filled at 12 %. */
export function FindingsLayer({ map, zIndex, opacity, style, projectId, frame }: LayerMountProps) {
  const { side } = useMapPane();
  const selection = useWorkspace((s) => s.selection);
  const filters = useMemo(() => findingFilters(style), [style]);
  useFindingsInView(map, { projectId, frame, side, allSurveys: filters.allSurveys });
  const pins = useMapFindingsStore((s) => s.bySide[side] ?? EMPTY);
  const scale = useSeverityScale();
  const { types } = useProjectTypes(projectId);
  const [hover, setHover] = useState<{ id: string; px: number[] } | null>(null);
  const layerRef = useRef<VectorLayer | null>(null);
  const selId = selection?.kind === "finding" ? selection.id : null;
  const topLevel = scale.reduce((m, l) => Math.max(m, l.level), 0);

  useEffect(() => {
    const layer = new VectorLayer({ source: new VectorSource(), zIndex, style: styleFor });
    // W3-11: the one-shot ring pulse, drawn over the pin while `usePulseStore` holds it.
    const onPostRender = (event: RenderEvent) => {
      const source = layer.getSource();
      if (!source) return;
      const now = performance.now();
      const vc = getVectorContext(event);
      let active = false;
      for (const [id, t0] of Object.entries(usePulseStore.getState().started)) {
        const frameAt = pulseFrame(now - t0);
        const geometry = source.getFeatureById(id)?.getGeometry();
        if (!frameAt || !geometry) continue;
        active = true;
        const at =
          geometry instanceof Point
            ? geometry.getCoordinates()
            : centroid((geometry as Polygon).getCoordinates()[0]);
        vc.setStyle(
          new Style({
            image: new CircleStyle({
              radius: frameAt.radius,
              stroke: new Stroke({ color: tokenColour("accent-ink", frameAt.alpha), width: 2 }),
            }),
          }),
        );
        vc.drawGeometry(new Point(at));
      }
      if (active) map.render();
      else usePulseStore.getState().prune(now);
    };
    layer.on("postrender", onPostRender);
    map.addLayer(layer);
    layerRef.current = layer;
    const unsubscribe = usePulseStore.subscribe(() => map.render());
    return () => {
      unsubscribe();
      layer.un("postrender", onPostRender);
      map.removeLayer(layer);
      layerRef.current = null;
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
    source.addFeatures(
      visibleFindings(pins, filters).map((f) =>
        toFeature(f, severityOf(scale, f.severity)?.colour ?? null, f.severity === topLevel, f.id === selId),
      ),
    );
  }, [pins, filters, scale, topLevel, selId, map, zIndex]);

  // W3-11: a selected pin pulses once (one pane starts it); the store ignores it under reduced motion.
  useEffect(() => {
    if (selId && side !== "left") usePulseStore.getState().pulse(selId);
  }, [selId, side]);

  // Glass F7: the hover tooltip follows the pin under the pointer; leaving the map hides it.
  useEffect(() => {
    const onMove = (e: { pixel: number[]; dragging?: boolean }) => {
      const layer = layerRef.current;
      if (!layer || e.dragging) return;
      const id = map.forEachFeatureAtPixel(e.pixel, (f) => f.getId() as string | undefined, {
        hitTolerance: 4,
        layerFilter: (l) => l === layer,
      });
      setHover((prev) => (id ? { id, px: e.pixel } : prev === null ? prev : null));
    };
    const onLeave = () => setHover(null);
    const viewport = map.getViewport();
    map.on("pointermove", onMove);
    viewport.addEventListener("pointerleave", onLeave);
    return () => {
      map.un("pointermove", onMove);
      viewport.removeEventListener("pointerleave", onLeave);
    };
  }, [map]);

  const hovered = hover ? visibleFindings(pins, filters).find((f) => f.id === hover.id) : undefined;
  if (!hover || !hovered) return null;
  return (
    <GlassPanel
      variant="float"
      role="tooltip"
      className="pointer-events-none absolute z-10 flex flex-col gap-1 px-2.5 py-2"
      style={{ left: hover.px[0] + 14, top: hover.px[1] + 14 }}
    >
      <div className="flex items-center gap-2">
        <SeverityPill level={hovered.severity} size="sm" />
        <span className="text-sm font-medium text-glass-ink">
          {types.get(hovered.type_id)?.name ?? "Unknown type"}
        </span>
      </div>
      <span className="font-mono text-2xs text-muted">{tooltipLine(hovered)}</span>
    </GlassPanel>
  );
}
