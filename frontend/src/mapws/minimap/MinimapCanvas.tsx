import { useEffect, useRef, useState, type PointerEvent } from "react";
import Feature from "ol/Feature";
import OlMap from "ol/Map";
import View from "ol/View";
import Polygon from "ol/geom/Polygon";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Fill, Stroke, Style } from "ol/style";
import { useBackend } from "@/api/client";
import { tokenColour } from "@/maps/styles";
import type { LayerRow } from "../layers/layerRegistry";
import { makeRasterLayer } from "../layers/makeRasterLayer";
import { tileExtras } from "../layers/rasterStyle";
import type { Coord, SiteFrame } from "../types";
import { siteProjection } from "../view/siteFrame";
import type { SiteExtent } from "../view/siteGrid";

export interface MinimapCanvasProps {
  frame: SiteFrame;
  projectId: string;
  ortho: LayerRow | null;
  extent: SiteExtent | null;
  ring: Coord[] | null;
  onRecentre: (c: Coord) => void;
}

interface Mini {
  map: OlMap;
  box: Feature<Polygon>;
}

const footprintOf = (fp: readonly number[] | null | undefined): SiteExtent | null =>
  Array.isArray(fp) && fp.length === 4 && fp.every(Number.isFinite) ? (fp as SiteExtent) : null;

/**
 * A small ol/Map of its own (deviation 5): the right date's ortho, fitted to the site, and the
 * viewport box. No controls or interactions: a click or drag only recentres the main view. Every OL
 * object is built and disposed inside one effect (StrictMode-safe, like RasterMount).
 */
export function MinimapCanvas({ frame, projectId, ortho, extent, ring, onRecentre }: MinimapCanvasProps) {
  const { baseUrl, token } = useBackend();
  const target = useRef<HTMLDivElement>(null);
  const [mini, setMini] = useState<Mini | null>(null);
  const dragging = useRef(false);

  useEffect(() => {
    // OL sizes its map with a ResizeObserver; without one (jsdom) there is nothing to draw into.
    if (!target.current || typeof ResizeObserver === "undefined") return;
    const box = new Feature<Polygon>();
    const boxLayer = new VectorLayer({
      source: new VectorSource({ features: [box] }),
      style: new Style({
        stroke: new Stroke({ color: tokenColour("ink", 0.95), width: 1.5 }),
        fill: new Fill({ color: tokenColour("accent", 0.12) }),
      }),
      zIndex: 10,
    });
    const map = new OlMap({
      target: target.current,
      controls: [],
      interactions: [],
      layers: [boxLayer],
      view: new View({ projection: siteProjection(frame) }),
    });
    setMini({ map, box });
    return () => {
      setMini(null);
      map.setTarget(undefined);
      map.removeLayer(boxLayer);
      boxLayer.dispose();
      map.dispose();
    };
  }, [frame]);

  const map = mini?.map ?? null;
  const orthoId = ortho?.id ?? null;
  const orthoVersion = ortho?.version ?? "0";
  const maxZoom = ortho?.layer?.max_zoom ?? null;
  const orthoExtent = JSON.stringify(footprintOf(ortho?.layer?.footprint_site));
  useEffect(() => {
    if (!map || !orthoId) return;
    const layer = makeRasterLayer(
      {
        kind: "map",
        id: orthoId,
        version: orthoVersion,
        maxZoom,
        extent: JSON.parse(orthoExtent) as SiteExtent | null,
        extras: tileExtras("map", {}, frame),
      },
      {
        projection: map.getView().getProjection(),
        baseUrl,
        token,
        projectId,
        // The main map's RasterMount already reports a gone layer once (W2-9).
        onGone: () => undefined,
      },
    );
    map.addLayer(layer);
    return () => {
      map.removeLayer(layer);
      layer.dispose();
    };
  }, [map, orthoId, orthoVersion, maxZoom, orthoExtent, frame, baseUrl, token, projectId]);

  useEffect(() => {
    if (map && extent) map.getView().fit(extent, { padding: [4, 4, 4, 4], size: map.getSize() });
  }, [map, extent]);

  useEffect(() => {
    mini?.box.setGeometry(ring ? new Polygon([ring]) : undefined);
  }, [mini, ring]);

  const at = (e: PointerEvent<HTMLDivElement>) => {
    if (!map) return;
    const c = map.getEventCoordinate(e.nativeEvent);
    if (c) onRecentre([c[0], c[1]]);
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!map || e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragging.current = true;
    at(e);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) at(e);
  };
  const end = () => {
    dragging.current = false;
  };

  return (
    <div
      ref={target}
      data-testid="minimap-map"
      aria-hidden="true"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      className="absolute inset-0 cursor-pointer touch-none"
    />
  );
}
