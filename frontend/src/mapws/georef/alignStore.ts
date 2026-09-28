import { create } from "zustand";
import type { Drawing, DrawingGeoref } from "@/api/drawings";
import type { ViewInfo } from "@/mapws/state/workspaceStore";
import type { SiteFrame } from "@/mapws/types";
import {
  clickAt,
  removePair,
  setModel,
  startSession,
  undoLast,
  type AlignSession,
  type Extent4,
} from "./alignModel";
import { UNIT_METRES, type Affine, type GeorefModelName, type Vec2 } from "./fit";

interface AlignState {
  session: AlignSession | null;
  /** One line for the inspector: a missed click, a restart in the site frame. */
  notice: string | null;
  begin: (session: AlignSession, notice?: string | null) => void;
  click: (p: Vec2) => void;
  removePair: (id: string) => void;
  /** Backspace / Ctrl+Z; false when there was nothing to undo. */
  undo: () => boolean;
  /** Esc; false when no first click was pending. */
  cancelPending: () => boolean;
  setModel: (m: GeorefModelName) => void;
  end: () => void;
  /** Ends the session only if it belongs to `drawingId` (the inspector's unmount, a save, a delete). */
  endFor: (drawingId: string) => void;
}

export const useAlignStore = create<AlignState>((set, get) => ({
  session: null,
  notice: null,
  begin: (session, notice = null) => set({ session, notice }),
  click: (p) => {
    const s = get().session;
    if (!s) return;
    const r = clickAt(s, p);
    set({ session: r.session, notice: r.notice });
  },
  removePair: (id) => {
    const s = get().session;
    if (s) set({ session: removePair(s, id), notice: null });
  },
  undo: () => {
    const s = get().session;
    if (!s || (s.pendingSrc === null && s.pairs.length === 0)) return false;
    set({ session: undoLast(s), notice: null });
    return true;
  },
  cancelPending: () => {
    const s = get().session;
    if (!s?.pendingSrc) return false;
    set({ session: { ...s, pendingSrc: null }, notice: null });
    return true;
  },
  setModel: (m) => {
    const s = get().session;
    if (s) set({ session: setModel(s, m) });
  },
  end: () => set({ session: null, notice: null }),
  endFor: (drawingId) => {
    if (get().session?.drawingId === drawingId) set({ session: null, notice: null });
  },
}));

/**
 * Controller ruling PF17: this must NOT take an OL map — Task 9's tool Overlay is rendered outside
 * the map pane (W1 renders it as a sibling of `SiteMap`, PF9) and so has none. The provisional
 * placement is north-up, so rotation is ignored; `view`/`sizePx` come from the workspace store's
 * `viewInfo` and the stage element's measured size.
 */
export function viewportOf(view: ViewInfo, sizePx: readonly [number, number]): Extent4 {
  const [w, h] = sizePx;
  const halfW = (view.resolution * w) / 2;
  const halfH = (view.resolution * h) / 2;
  const [cx, cy] = view.center;
  return [cx - halfW, cy - halfH, cx + halfW, cy + halfH];
}

/** A WKT's trailing `ID["EPSG",n]` / `AUTHORITY["EPSG","n"]`, if any. */
function epsgOfWkt(wkt: string | null): number | null {
  if (wkt === null) return null;
  const m = /(?:ID|AUTHORITY)\[\s*"EPSG"\s*,\s*"?(\d+)"?\s*\]\s*\]?\s*$/.exec(wkt);
  return m ? Number(m[1]) : null;
}

/**
 * R-W5-5: is this saved placement expressed in the current site frame? The client cannot compose a
 * pyproj transform, so a session only resumes from a saved placement that already lives in `frame`.
 * For control points the server stores `frame.crs_wkt` verbatim (`backend/app/drawings/router.py:276`);
 * `crs`/`embedded` placements compare `epsg` (their transform maps into the drawing's own CRS,
 * `backend/app/drawings/placement.py:88-109`).
 *
 * Deviation from the dispatched PF7 formula: the brief gives
 * `g.dst_crs_wkt === frame.crs_wkt || epsgOfWkt(g.dst_crs_wkt) === frame.epsg`, but that `||` can
 * never be false once the first operand is true regardless of operand order, so it fails the brief's
 * own verbatim test (a frame spread with only `epsg` overridden, `crs_wkt` left unchanged, must
 * report "not in frame"). EPSG is treated as authoritative whenever the frame carries one; the WKT
 * string is compared only as a fallback for a `crs` frame with no EPSG.
 */
export function placementInFrame(g: DrawingGeoref, frame: SiteFrame): boolean {
  if (g.method === "control_points") {
    if (g.dst_crs_wkt === null) return frame.kind === "local";
    if (frame.kind !== "crs") return false;
    return frame.epsg !== null ? epsgOfWkt(g.dst_crs_wkt) === frame.epsg : g.dst_crs_wkt === frame.crs_wkt;
  }
  return frame.kind === "crs" && g.epsg !== null && g.epsg === frame.epsg;
}

export function sessionFor(
  d: Drawing,
  viewport: Extent4,
  frame: SiteFrame,
): { session: AlignSession; notice: string | null } {
  const g = d.georef;
  const inFrame = g !== null && placementInFrame(g, frame);
  const saved =
    g && inFrame
      ? {
          transform: g.transform as Affine,
          model: (g.model ?? "similarity") as GeorefModelName,
          points:
            g.method === "control_points"
              ? g.points.map((p) => ({
                  id: p.id,
                  src: p.src as Vec2,
                  dst: p.dst as Vec2,
                }))
              : [],
        }
      : null;
  const session = startSession({
    drawingId: d.id,
    extentSrc: (d.extent_src ?? [0, 0, 1, 1]) as Extent4,
    viewport,
    saved,
    unitsScale: d.units ? UNIT_METRES[d.units] : null,
  });
  const notice =
    g && !inFrame
      ? "This drawing was placed in another CRS; aligning starts afresh in the site frame."
      : null;
  return { session, notice };
}
