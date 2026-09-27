import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { mapTileUrl, type GeoMap } from "@contract/client";
import { useApi, useBackend } from "@/api/client";
import { messageOf } from "@/api/errors";
import { listMaps } from "@/api/maps";
import { rendererName } from "@/app/effects";
import { pushLog } from "@/app/diagnostics";
import { tokenColour } from "@/maps/styles";
import { useSeverityScale } from "@/ui";
import {
  flightPath,
  footprintShape,
  gpsPoints,
  idsInExtent,
  pickBackground,
  pointStyle,
  projector,
  type CapturePoint,
  type FootprintInput,
  type ViewProjection,
} from "./captureModel";
import type { BrowserSort } from "./filters";
import { createCaptureMap, type CaptureMapHandle } from "./olCaptureMap";
import type { ImageIndexState } from "./useImageIndex";

export interface CaptureMapInput {
  projectId: string;
  index: ImageIndexState;
  currentId: string | null;
  interactive: boolean;
  onOpen: (id: string) => void;
  onLasso?: (ids: string[]) => void;
  /** Map mode only: the flight path follows the sort; the footprint is the current frame's. */
  sort?: BrowserSort;
  footprint?: FootprintInput | null;
  showFootprint?: boolean;
}

export interface CaptureMapView {
  targetRef: RefObject<HTMLDivElement>;
  webgl: boolean;
  points: CapturePoint[];
  background: GeoMap | null;
  hovered: { ordinal: number; pixel: number[] } | null;
}

function useMaps(projectId: string): GeoMap[] {
  const api = useApi();
  const [loaded, setLoaded] = useState<{ projectId: string; maps: GeoMap[] } | null>(null);
  useEffect(() => {
    let cancelled = false;
    listMaps(api, projectId).then(
      (maps) => {
        if (!cancelled) setLoaded({ projectId, maps });
      },
      (e: unknown) => pushLog(`capture map background unavailable: ${messageOf(e, String(e))}`),
    );
    return () => {
      cancelled = true;
    };
  }, [api, projectId]);
  return loaded?.projectId === projectId ? loaded.maps : [];
}

/** The capture map's state and its one OpenLayers map, rebuilt only when the projection changes. */
export function useCaptureMap(input: CaptureMapInput): CaptureMapView {
  const { baseUrl, token } = useBackend();
  const scale = useSeverityScale();
  const targetRef = useRef<HTMLDivElement>(null);
  const handle = useRef<CaptureMapHandle | null>(null);
  const [hovered, setHovered] = useState<{ ordinal: number; pixel: number[] } | null>(null);
  const webgl = useMemo(() => rendererName() !== null, []);
  const maps = useMaps(input.projectId);
  const { index } = input;

  const points = useMemo(
    () => gpsPoints(index),
    // The arrays are replaced together on every index answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [index.ids, index.lon, index.lat, index.sev, index.count],
  );
  const background = useMemo(() => pickBackground(maps, points), [maps, points]);
  const projection = useMemo<ViewProjection>(
    () => (background ? { kind: "ortho", map: background } : { kind: "mercator" }),
    [background],
  );
  const project = useMemo(() => projector(projection), [projection]);
  const coords = useMemo(() => points.map((p) => project(p.lon, p.lat)), [points, project]);
  const style = useMemo(() => pointStyle(scale, tokenColour("muted")), [scale]);
  const tileUrl = background ? mapTileUrl(baseUrl, token, input.projectId, background.id) : null;

  const placed = useMemo(() => {
    const ordinals: number[] = [];
    const xy: number[][] = [];
    const sev: number[] = [];
    const count: number[] = [];
    coords.forEach((c, i) => {
      if (!c) return;
      ordinals.push(points[i].ordinal);
      xy.push(c);
      sev.push(points[i].sev);
      count.push(points[i].count);
    });
    return { ordinals, xy, sev, count };
  }, [coords, points]);

  const currentOrdinal = index.ordinalOf(input.currentId);
  const currentCoord = useMemo(() => {
    if (currentOrdinal < 0) return null;
    const lon = index.lon[currentOrdinal];
    const lat = index.lat[currentOrdinal];
    return lon === null || lat === null || lon === undefined || lat === undefined ? null : project(lon, lat);
  }, [currentOrdinal, index.lon, index.lat, project]);
  const footprint = useMemo(
    () => (input.showFootprint && input.footprint ? footprintShape(input.footprint, project) : null),
    [input.showFootprint, input.footprint, project],
  );
  const path = useMemo(() => (input.sort ? flightPath(coords, input.sort) : null), [coords, input.sort]);

  // Everything the builder needs, read by the creation effect without making it a dependency.
  const latest = useRef({ input, placed, currentCoord, footprint, path, style, points, coords });
  useEffect(() => {
    latest.current = { input, placed, currentCoord, footprint, path, style, points, coords };
  });

  const projectionKey = background ? `ortho:${background.id}` : "mercator";
  useEffect(() => {
    const target = targetRef.current;
    if (!webgl || !target) return;
    let h: CaptureMapHandle;
    try {
      h = createCaptureMap({
        target,
        projection,
        tileUrl,
        interactive: input.interactive,
        pointStyle: latest.current.style,
        onHover: (ordinal, pixel) => setHovered(ordinal === null || !pixel ? null : { ordinal, pixel }),
        onClick: (ordinal) => {
          const id = latest.current.input.index.ids[ordinal];
          if (id) latest.current.input.onOpen(id);
        },
        onLasso:
          input.interactive && input.onLasso
            ? (extent) =>
                latest.current.input.onLasso?.(
                  idsInExtent(latest.current.points, latest.current.coords, extent),
                )
            : undefined,
      });
    } catch (e) {
      pushLog(`capture map failed to start: ${messageOf(e, String(e))}`);
      return;
    }
    handle.current = h;
    const l = latest.current;
    h.setPoints(l.placed.ordinals, l.placed.xy, l.placed.sev, l.placed.count);
    h.setCurrent(l.currentCoord);
    h.setFootprint(l.footprint);
    h.setFlightPath(l.path);
    h.fit(l.placed.xy);
    return () => {
      handle.current = null;
      h.destroy();
    };
    // Rebuilt only when the projection, tiles or interactivity change (projectionKey stands for projection).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webgl, projectionKey, tileUrl, input.interactive, Boolean(input.onLasso)]);

  useEffect(() => {
    handle.current?.setPoints(placed.ordinals, placed.xy, placed.sev, placed.count);
    handle.current?.fit(placed.xy);
  }, [placed]);
  // Block bodies: an effect must return only a cleanup function, and the handle's setters are not void.
  useEffect(() => {
    handle.current?.setPointStyle(style);
  }, [style]);
  useEffect(() => {
    handle.current?.setCurrent(currentCoord);
  }, [currentCoord]);
  useEffect(() => {
    handle.current?.setFootprint(footprint);
  }, [footprint]);
  useEffect(() => {
    handle.current?.setFlightPath(path);
  }, [path]);

  return { targetRef, webgl, points, background, hovered };
}
