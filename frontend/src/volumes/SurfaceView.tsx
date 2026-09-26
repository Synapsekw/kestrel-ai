import { useEffect, useRef } from "react";
import OlMap from "ol/Map";
import View from "ol/View";
import TileLayer from "ol/layer/Tile";
import TileImage from "ol/source/TileImage";
import Projection from "ol/proj/Projection";
import type { Surface } from "@contract/client";
import { makeTileGrid } from "@/maps/MapView";
import { fromOl, olExtent, resolutions, type Extent } from "@/maps/grid";
import { surfaceGrid } from "./model";

const OVERZOOM = [0.5, 0.25];

function source(projection: Projection, s: Surface, url: string): TileImage {
  return new TileImage({
    projection,
    tileGrid: makeTileGrid(surfaceGrid(s)),
    tileUrlFunction: (c) =>
      c
        ? url.replace("{z}", String(c[0])).replace("{x}", String(c[1])).replace("{y}", String(c[2]))
        : undefined,
    transition: 0,
    interpolate: true,
  });
}

export interface SurfaceViewProps {
  surface: Surface;
  /** `surfaceTileUrl(...)`. */
  hillshadeUrl: string;
  /** `surfaceOrthoTileUrl(...)` when the ortho underlay is on. */
  orthoUrl: string | null;
  /** 0..1: 1 with no ortho, 0.35 over the ortho. */
  hillshadeOpacity: number;
  onReady?: (map: OlMap | null) => void;
  onPointer?: (px: number, py: number) => void;
  onViewChange?: (v: { extent: Extent; resolution: number }) => void;
}

/**
 * The top surface's own pixel grid in OpenLayers, exactly as `MapView` shows a map: no reprojection
 * on screen, so polygons convert through the surface's north-up affine only. Hillshade, ortho and
 * cut/fill tiles are rendered by the backend in this grid; the vector layers are added to the
 * `ol/Map` handed to `onReady` by `useVolumeLayers` and `useDiffLayer`.
 */
export function SurfaceView({
  surface,
  hillshadeUrl,
  orthoUrl,
  hillshadeOpacity,
  onReady,
  onPointer,
  onViewChange,
}: SurfaceViewProps) {
  const target = useRef<HTMLDivElement>(null);
  const layers = useRef<{
    map: OlMap;
    hillshade: TileLayer;
    ortho: TileLayer;
    projection: Projection;
  } | null>(null);
  const callbacks = useRef({ onReady, onPointer, onViewChange });
  useEffect(() => {
    callbacks.current = { onReady, onPointer, onViewChange };
  });

  useEffect(() => {
    if (!target.current) return;
    const grid = surfaceGrid(surface);
    const extent = olExtent(grid);
    const projection = new Projection({ code: `kestrel-surface-${surface.id}`, units: "pixels", extent });
    const res = resolutions(grid.tile_grid.max_zoom);
    const hillshade = new TileLayer({
      source: source(projection, surface, hillshadeUrl),
      zIndex: 1,
      preload: 1,
    });
    const ortho = new TileLayer({ zIndex: 0, preload: 1 });
    const map = new OlMap({
      target: target.current,
      layers: [ortho, hillshade],
      controls: [],
      view: new View({
        projection,
        extent,
        resolutions: [...res, ...OVERZOOM],
        constrainOnlyCenter: true,
        showFullExtent: true,
      }),
    });
    map.getView().fit(extent, { padding: [24, 24, 24, 24] });
    const onMove = (e: { coordinate: number[] }) => callbacks.current.onPointer?.(...fromOl(e.coordinate));
    const onEnd = () => {
      const view = map.getView();
      callbacks.current.onViewChange?.({
        extent: view.calculateExtent(map.getSize()) as Extent,
        resolution: view.getResolution() ?? res[0],
      });
    };
    map.on("pointermove", onMove);
    map.on("moveend", onEnd);
    layers.current = { map, hillshade, ortho, projection };
    callbacks.current.onReady?.(map);
    return () => {
      callbacks.current.onReady?.(null);
      layers.current = null;
      map.setTarget(undefined);
      map.dispose();
    };
  }, [surface.id, surface.width, surface.height, hillshadeUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const l = layers.current;
    if (!l) return;
    l.ortho.setSource(orthoUrl ? source(l.projection, surface, orthoUrl) : null);
    l.hillshade.setOpacity(hillshadeOpacity);
  }, [orthoUrl, hillshadeOpacity, surface.id, hillshadeUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={target} className="absolute inset-0 bg-bg" data-testid="surface-view" />;
}
