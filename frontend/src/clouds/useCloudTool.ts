import { useMemo, useReducer, type Dispatch } from "react";
import type { CloudMeasurementKind } from "@contract/client";
import { MAX_AREA_VERTICES, RING_MIN_PICKS, RINGS_MAX_PICKS, SAME_POINT_M, type MPoint } from "./measure";

/** The picks of every measure tool (spec 2026-09-26-point-cloud-workspace sections 8.3 and 15). */
export type ToolKind = CloudMeasurementKind;
export type LeanMethod = "points" | "rings";
export type AreaMode = "surface" | "plan";
export interface ToolPoint extends MPoint {
  /** Rings only: 0 is the ring picked first, 1 the second. */
  group?: 0 | 1;
}

export interface CloudToolState {
  kind: ToolKind | null;
  picks: ToolPoint[];
  hover: MPoint | null;
  /** Rings: the ring the next pick goes to. */
  ring: 0 | 1;
  /** Area: the outline is closed. */
  closed: boolean;
  method: LeanMethod;
  mode: AreaMode;
  thicknessM: number;
}

export type CloudToolAction =
  | { type: "arm"; kind: ToolKind | null }
  | { type: "pick"; point: MPoint; closes?: boolean }
  | { type: "hover"; point: MPoint | null }
  | { type: "close" }
  | { type: "backspace" }
  | { type: "next-ring" }
  | { type: "reset" }
  | { type: "method"; method: LeanMethod }
  | { type: "mode"; mode: AreaMode }
  | { type: "thickness"; thicknessM: number };

/** A click this close (px) to the first vertex's projection closes the outline. */
export const CLOSE_PX = 10;
export const DEFAULT_THICKNESS_M = 0.2;
export const THICKNESS_STOPS: readonly number[] = [0.05, 0.1, 0.2, 0.5, 1, 2];

export const INITIAL_TOOL: CloudToolState = {
  kind: null,
  picks: [],
  hover: null,
  ring: 0,
  closed: false,
  method: "points",
  mode: "surface",
  thicknessM: DEFAULT_THICKNESS_M,
};

const plain = (p: MPoint): MPoint => ({ x: p.x, y: p.y, z: p.z, uncertainty_m: p.uncertainty_m });
const same = (a: MPoint, b: MPoint) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) <= SAME_POINT_M;

export function isRings(s: Pick<CloudToolState, "kind" | "method">): boolean {
  return s.kind === "vertical" && s.method === "rings";
}

export function ringCounts(picks: readonly ToolPoint[]): [number, number] {
  let lower = 0;
  let upper = 0;
  for (const p of picks) {
    if (p.group === 1) upper++;
    else lower++;
  }
  return [lower, upper];
}

/** Picks a fixed-count tool needs (area and rings have none). */
function fixedCount(kind: ToolKind): 1 | 2 | null {
  if (kind === "point") return 1;
  if (kind === "area") return null;
  return 2;
}

export function isComplete(s: CloudToolState): boolean {
  if (!s.kind) return false;
  if (s.kind === "area") return s.closed && s.picks.length >= 3;
  if (isRings(s)) {
    const [lower, upper] = ringCounts(s.picks);
    return lower >= RING_MIN_PICKS && upper >= RING_MIN_PICKS;
  }
  return s.picks.length === fixedCount(s.kind);
}

/** Enter closes an open outline of three or more vertices before it saves. */
export function canCloseArea(s: CloudToolState): boolean {
  return s.kind === "area" && !s.closed && s.picks.length >= 3;
}

/** The closing vertex (a repeat of the first) never becomes a vertex (C-B1 Review Focus 1). */
function closeOutline(picks: readonly ToolPoint[]): ToolPoint[] {
  const out = [...picks];
  while (out.length > 3 && same(out[out.length - 1], out[0])) out.pop();
  return out;
}

/** The click `p` lands within `px` of `vertex` on screen: closing the outline on its first vertex,
 * or on its last one (the second click of a double-click; W1 routes no double-click to tools). */
export function nearVertex(
  project: (p: MPoint) => { x: number; y: number } | null,
  vertex: MPoint,
  p: MPoint,
  px = CLOSE_PX,
): boolean {
  const a = project(vertex);
  const b = project(p);
  return !!a && !!b && Math.hypot(a.x - b.x, a.y - b.y) <= px;
}

function pick(s: CloudToolState, raw: MPoint, closes: boolean): CloudToolState {
  if (!s.kind) return s;
  const p = plain(raw);
  const last = s.picks[s.picks.length - 1];
  if (s.kind === "area") {
    if (s.closed) return { ...s, picks: [p], closed: false };
    if (closes && s.picks.length >= 3) return { ...s, picks: closeOutline(s.picks), closed: true };
    if ((last && same(last, p)) || s.picks.length >= MAX_AREA_VERTICES) return s;
    return { ...s, picks: [...s.picks, p] };
  }
  if (isRings(s)) {
    if ((last && same(last, p)) || s.picks.length >= RINGS_MAX_PICKS) return s;
    return { ...s, picks: [...s.picks, { ...p, group: s.ring }] };
  }
  const n = fixedCount(s.kind) ?? 1;
  const base = s.picks.length >= n ? [] : s.picks;
  const next = s.kind === "profile" && base.length === 1 ? { ...p, z: base[0].z } : p;
  return { ...s, picks: [...base, next] };
}

function backspace(s: CloudToolState): CloudToolState {
  if (!s.kind) return s;
  if (isRings(s) && s.ring === 1 && ringCounts(s.picks)[1] === 0) return { ...s, ring: 0 };
  if (s.picks.length === 0) return s;
  return { ...s, picks: s.picks.slice(0, -1), closed: false };
}

export function cloudToolReducer(s: CloudToolState, a: CloudToolAction): CloudToolState {
  switch (a.type) {
    case "arm":
      return { ...INITIAL_TOOL, method: s.method, mode: s.mode, thicknessM: s.thicknessM, kind: a.kind };
    case "reset":
      return { ...s, picks: [], hover: null, ring: 0, closed: false };
    case "hover":
      return s.kind ? { ...s, hover: a.point ? plain(a.point) : null } : s;
    case "pick":
      return pick(s, a.point, a.closes === true);
    case "close":
      return canCloseArea(s) ? { ...s, picks: closeOutline(s.picks), closed: true } : s;
    case "backspace":
      return backspace(s);
    case "next-ring":
      return isRings(s) && s.ring === 0 && ringCounts(s.picks)[0] >= RING_MIN_PICKS ? { ...s, ring: 1 } : s;
    case "method":
      return { ...s, method: a.method, picks: [], ring: 0, closed: false };
    case "mode":
      return { ...s, mode: a.mode };
    case "thickness":
      return { ...s, thicknessM: a.thicknessM };
  }
}

export function useCloudTool(): {
  state: CloudToolState;
  dispatch: Dispatch<CloudToolAction>;
  complete: boolean;
} {
  const [state, dispatch] = useReducer(cloudToolReducer, INITIAL_TOOL);
  const complete = isComplete(state);
  return useMemo(() => ({ state, dispatch, complete }), [state, complete]);
}

export type CloudTool = ReturnType<typeof useCloudTool>;
