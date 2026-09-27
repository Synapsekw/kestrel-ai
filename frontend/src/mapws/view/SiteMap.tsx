/* eslint-disable react-refresh/only-export-components --
   the stage and the hook its layer mounts use belong to one module. */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import OlMap from "ol/Map";
import type MapBrowserEvent from "ol/MapBrowserEvent";
import View from "ol/View";
import { defaults as defaultInteractions } from "ol/interaction/defaults";
import { useWorkspace, useWorkspaceStores } from "../context";
import type { Placement } from "../layers/placement";
import { mapsFor } from "../layers/placement";
import type { ViewInfo } from "../state/workspaceStore";
import type { CompareMode, Coord, MapSide, SiteFrame } from "../types";
import { DrawHost } from "./DrawHost";
import { siteProjection, viewResolutions } from "./siteFrame";
import { siteRes } from "./siteGrid";
import { makeViewApi, readView } from "./viewApi";

export interface MapPane {
  map: OlMap;
  side: MapSide;
}

const PaneContext = createContext<MapPane | null>(null);

/** The ol/Map (and its side) a layer Mount or a tool Overlay renders into. */
export function useMapPane(): MapPane {
  const pane = useContext(PaneContext);
  if (!pane) throw new Error("useMapPane must be used inside SiteMap");
  return pane;
}

/** One store write per animation frame for high-rate OL events. */
function perFrame<A extends unknown[]>(
  fn: (...args: A) => void,
): ((...args: A) => void) & { cancel: () => void } {
  let id = 0;
  let last: A | null = null;
  const run = (...args: A) => {
    last = args;
    if (id) return;
    id = requestAnimationFrame(() => {
      id = 0;
      if (last) fn(...last);
    });
  };
  return Object.assign(run, { cancel: () => cancelAnimationFrame(id) });
}

export interface SiteMapProps {
  frame: SiteFrame;
  mode: CompareMode;
  placements: readonly Placement[];
  initialView: ViewInfo | null;
  projectId: string;
}

/**
 * The stage (spec M1, M7): one OL View in the site CRS; one ol/Map, or two sharing the View in
 * Side-by-side. Keyed by the frame in MapWorkspace, so a site CRS change rebuilds it (spec §14).
 */
export function SiteMap({ frame, mode, placements, initialView, projectId }: SiteMapProps) {
  const setViewApi = useWorkspace((s) => s.setViewApi);
  const setViewInfo = useWorkspace((s) => s.setViewInfo);
  const [view] = useState(
    () =>
      new View({
        projection: siteProjection(frame),
        resolutions: viewResolutions(),
        center: initialView?.center ?? [0, 0],
        resolution: initialView?.resolution ?? siteRes(8),
        rotation: initialView?.rotation ?? 0,
        constrainResolution: false,
      }),
  );

  // The rendered maps by side; pixelOf uses the single map, or the left one in Side-by-side.
  const maps = useRef(new Map<MapSide, OlMap>());
  const onMap = useCallback((side: MapSide, m: OlMap | null) => {
    if (m) maps.current.set(side, m);
    else maps.current.delete(side);
  }, []);

  useEffect(() => {
    setViewApi(makeViewApi(view, () => maps.current.get("single") ?? maps.current.get("left") ?? null));
    const publish = perFrame(() => setViewInfo(readView(view)));
    view.on("propertychange", publish);
    publish();
    return () => {
      view.un("propertychange", publish);
      publish.cancel();
      setViewApi(null);
    };
  }, [view, setViewApi, setViewInfo]);

  const sides = mapsFor(mode);
  return (
    <div className={sides.length === 2 ? "absolute inset-0 grid grid-cols-2" : "absolute inset-0"}>
      {sides.map((side) => (
        <MapPaneView
          key={side}
          side={side}
          view={view}
          placements={placements.filter((p) => p.map === side)}
          projectId={projectId}
          frame={frame}
          onMap={onMap}
        />
      ))}
    </div>
  );
}

function MapPaneView({
  side,
  view,
  placements,
  projectId,
  frame,
  onMap,
}: {
  side: MapSide;
  view: View;
  placements: readonly Placement[];
  projectId: string;
  frame: SiteFrame;
  onMap: (side: MapSide, map: OlMap | null) => void;
}) {
  const target = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<OlMap | null>(null);
  const setPointer = useWorkspace((s) => s.setPointer);
  const { workspace } = useWorkspaceStores();

  useEffect(() => {
    if (!target.current) return;
    const m = new OlMap({
      target: target.current,
      view,
      controls: [],
      // Keys belong to the app keymap; drag-pan is DrawHost's; double-click finishes drawings.
      interactions: defaultInteractions({
        doubleClickZoom: false,
        dragPan: false,
        keyboard: false,
      }),
    });
    const move = perFrame((e: MapBrowserEvent) => setPointer(e.coordinate as Coord));
    const leave = () => setPointer(null);
    m.on("pointermove", move);
    m.getViewport().addEventListener("pointerleave", leave);
    // Right-click: the stage menu ("Open this spot in 3D") at the site coordinate under the pointer.
    const menu = (e: MouseEvent) => {
      e.preventDefault();
      const c = m.getEventCoordinate(e);
      workspace.getState().openStageMenu({ x: e.clientX, y: e.clientY, coord: [c[0], c[1]] });
    };
    m.getViewport().addEventListener("contextmenu", menu);
    setMap(m);
    onMap(side, m);
    return () => {
      onMap(side, null);
      move.cancel();
      m.un("pointermove", move);
      m.getViewport().removeEventListener("pointerleave", leave);
      m.getViewport().removeEventListener("contextmenu", menu);
      m.setTarget(undefined);
      m.dispose();
      setMap(null);
    };
  }, [view, setPointer, onMap, side, workspace]);

  const pane = useMemo(() => (map ? { map, side } : null), [map, side]);
  return (
    <div
      ref={target}
      data-testid={side === "single" ? "site-map" : `site-map-${side}`}
      className="relative h-full w-full"
    >
      {pane && (
        <PaneContext.Provider value={pane}>
          <DrawHost />
          {placements.map((p) => {
            const Mount = p.kind.Mount!;
            return (
              <Mount
                key={p.row.key}
                row={p.row}
                map={pane.map}
                side={p.side}
                zIndex={p.zIndex}
                opacity={p.opacity}
                style={p.style}
                projectId={projectId}
                frame={frame}
              />
            );
          })}
        </PaneContext.Provider>
      )}
    </div>
  );
}
