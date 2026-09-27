import { Circle, Line } from "react-konva";
import {
  distance,
  flatten,
  fromPoints,
  toDisplay,
  type Point,
  type ViewTransform,
} from "@/images/canvas/geometry";
import type { Draft } from "@/store/imagesWorkspace";
import type { ToolDefinition } from "./types";

export const STREAM_STEP_PX = 4;
export const CLOSE_RADIUS_PX = 6;
export const MAX_VERTICES = 2000;
const SAME_VERTEX_PX = 1;

export type PolygonDraft = Extract<Draft, { kind: "polygon" }>;

function distinct(points: readonly Point[]): number {
  return new Set(points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)).size;
}

export function polygonClosable(d: PolygonDraft): boolean {
  return distinct(d.points) >= 3;
}

function append(d: PolygonDraft, image: Point, screen: Point, view: ViewTransform): PolygonDraft {
  if (d.points.length >= MAX_VERTICES) return d;
  const last = d.points[d.points.length - 1];
  if (last && distance(toDisplay(last, view), screen) < SAME_VERTEX_PX) return d;
  return { ...d, points: [...d.points, image], lastScreen: screen };
}

/** Press: close on the first vertex (≥ 3 distinct), else add a vertex and start streaming. */
export function polygonDown(
  d: PolygonDraft | null,
  image: Point,
  screen: Point,
  view: ViewTransform,
): { draft: PolygonDraft; close: boolean } {
  const base: PolygonDraft = d ?? {
    kind: "polygon",
    points: [],
    cursor: image,
    pressed: false,
    lastScreen: null,
  };
  const first = base.points[0];
  if (first && distance(toDisplay(first, view), screen) <= CLOSE_RADIUS_PX) {
    // m6: too few points to close yet, so the click is ignored rather than adding a near-duplicate.
    return { draft: { ...base, pressed: false }, close: polygonClosable(base) };
  }
  return {
    draft: { ...append(base, image, screen, view), pressed: true, cursor: image, lastScreen: screen },
    close: false,
  };
}

/** Move: the rubber band follows; while pressed, a vertex every STREAM_STEP_PX screen px. */
export function polygonMove(d: PolygonDraft, image: Point, screen: Point): PolygonDraft {
  if (
    !d.pressed ||
    !d.lastScreen ||
    distance(d.lastScreen, screen) < STREAM_STEP_PX ||
    d.points.length >= MAX_VERTICES
  ) {
    return { ...d, cursor: image };
  }
  return { ...d, points: [...d.points, image], cursor: image, lastScreen: screen };
}

export function polygonUp(d: PolygonDraft): PolygonDraft {
  return { ...d, pressed: false };
}

export function polygonRemoveLast(d: PolygonDraft): PolygonDraft | null {
  if (d.points.length <= 1) return null;
  return { ...d, points: d.points.slice(0, -1) };
}

function commit(d: PolygonDraft, api: Parameters<NonNullable<ToolDefinition["onCommit"]>>[0]): boolean {
  if (!polygonClosable(d)) return false;
  api.store.getState().setDraft(null);
  void api.createShape({ shape: "polygon", points: fromPoints(d.points) });
  return true;
}

export const POLYGON_TOOL: ToolDefinition = {
  id: "polygon",
  order: 50,
  action: "polygon",
  icon: "drawing",
  label: "Polygon",
  hint: "Click vertices; drag to trace",
  statusHints: "Click add point · Enter close · Backspace remove point · Esc cancel",
  cursor: "crosshair",
  drawsShapes: true,
  onDown: (p, api) => {
    if (p.button !== 0) return;
    const s = api.store.getState();
    const d = s.draft?.kind === "polygon" ? s.draft : null;
    if (d && d.points.length >= MAX_VERTICES)
      api.notify(`A polygon holds at most ${MAX_VERTICES} points. Press Enter to close it.`);
    const r = polygonDown(d, p.image, p.screen, s.view);
    if (r.close) commit(r.draft, api);
    else s.setDraft(r.draft);
  },
  onMove: (p, api) => {
    const s = api.store.getState();
    if (s.draft?.kind === "polygon") s.setDraft(polygonMove(s.draft, p.image, p.screen));
  },
  onUp: (_p, api) => {
    const s = api.store.getState();
    if (s.draft?.kind === "polygon") s.setDraft(polygonUp(s.draft));
  },
  onCommit: (api) => {
    const d = api.store.getState().draft;
    return d?.kind === "polygon" ? commit(d, api) : false;
  },
  onRemoveVertex: (api) => {
    const s = api.store.getState();
    if (s.draft?.kind !== "polygon") return false;
    s.setDraft(polygonRemoveLast(s.draft));
    return true;
  },
  onCancel: (api) => {
    if (api.store.getState().draft?.kind !== "polygon") return false;
    api.store.getState().setDraft(null);
    return true;
  },
  renderDraft: (d, ctx) => {
    if (d.kind !== "polygon" || d.points.length === 0) return null;
    const trail = d.cursor ? [...d.points, d.cursor] : d.points;
    const r = 4 / ctx.scale;
    return (
      <>
        <Line
          points={flatten(trail)}
          stroke={ctx.colour}
          strokeWidth={2}
          strokeScaleEnabled={false}
          dash={[4, 4]}
          listening={false}
          perfectDrawEnabled={false}
        />
        <Circle
          x={d.points[0].x}
          y={d.points[0].y}
          radius={r * 1.5}
          stroke={ctx.colour}
          strokeWidth={2}
          strokeScaleEnabled={false}
          listening={false}
        />
      </>
    );
  },
};
