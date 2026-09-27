import { Line } from "react-konva";
import {
  clampOriented,
  cornersOf,
  distance,
  flatten,
  MIN_DRAG_PX,
  rboxFromThreePoints,
  roundOriented,
  snapDirection,
  type OrientedRect,
  type Point,
  type ViewTransform,
} from "@/images/canvas/geometry";
import type { Draft } from "@/store/imagesWorkspace";
import type { ToolDefinition } from "./types";

export const RBOX_SNAP_DEG = 15;
export type RboxDraft = Extract<Draft, { kind: "rbox" }>;

/** Press: start the edge, or (in the width stage) finish the box. */
export function rboxDown(
  d: RboxDraft | null,
  p: Point,
  _view: ViewTransform,
): { draft: RboxDraft | null; commit: OrientedRect | null } {
  void _view; // kept for a symmetric signature with rboxUp; unused until a view-relative check is needed
  if (!d || d.stage === "edge") return { draft: { kind: "rbox", stage: "edge", a: p, b: p, c: null }, commit: null };
  const rect = rboxFromThreePoints(d.a, d.b, p);
  return rect ? { draft: null, commit: rect } : { draft: { ...d, c: p }, commit: null };
}

export function rboxMove(d: RboxDraft, p: Point, shift: boolean): RboxDraft {
  if (d.stage === "edge") return { ...d, b: shift ? snapDirection(d.a, p, RBOX_SNAP_DEG) : p };
  return { ...d, c: p };
}

/** Release after the edge drag: a click (under 4 screen px) draws nothing. */
export function rboxUp(d: RboxDraft, view: ViewTransform): RboxDraft | null {
  if (d.stage !== "edge") return d;
  if (distance(d.a, d.b) * view.scale < MIN_DRAG_PX) return null;
  return { ...d, stage: "width", c: d.b };
}

export const RBOX_TOOL: ToolDefinition = {
  id: "rbox",
  order: 40,
  action: "rotated-box",
  icon: "refresh",
  label: "Rotated box",
  hint: "Drag an edge, then move for the width",
  statusHints: "Drag edge · Move width · Click finish · Shift snap 15° · Esc cancel",
  cursor: "crosshair",
  drawsShapes: true,
  onDown: (p, api) => {
    if (p.button !== 0) return;
    const s = api.store.getState();
    const d = s.draft?.kind === "rbox" ? s.draft : null;
    const { draft, commit } = rboxDown(d, p.image, s.view);
    s.setDraft(draft);
    if (commit && s.image) void api.createShape({ shape: "rbox", ...roundOriented(clampOriented(commit, s.image)) });
  },
  onMove: (p, api) => {
    const s = api.store.getState();
    if (s.draft?.kind === "rbox") s.setDraft(rboxMove(s.draft, p.image, p.shift));
  },
  onUp: (_p, api) => {
    const s = api.store.getState();
    if (s.draft?.kind === "rbox" && s.draft.stage === "edge") s.setDraft(rboxUp(s.draft, s.view));
  },
  onCancel: (api) => {
    if (api.store.getState().draft?.kind !== "rbox") return false;
    api.store.getState().setDraft(null);
    return true;
  },
  renderDraft: (d, ctx) => {
    if (d.kind !== "rbox") return null;
    const rect = d.c ? rboxFromThreePoints(d.a, d.b, d.c) : null;
    const points = rect ? flatten(cornersOf(rect)) : flatten([d.a, d.b]);
    return (
      <Line
        points={points}
        closed={!!rect}
        stroke={ctx.colour}
        strokeWidth={2}
        strokeScaleEnabled={false}
        dash={[4, 4]}
        listening={false}
        perfectDrawEnabled={false}
      />
    );
  },
};
