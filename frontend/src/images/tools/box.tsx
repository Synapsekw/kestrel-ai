import { Rect as KonvaRect } from "react-konva";
import { dragRect, type Point, type Size, type ViewTransform } from "@/images/canvas/geometry";
import type { Draft } from "@/store/imagesWorkspace";
import type { ToolDefinition } from "./types";

export type RectDraft = Extract<Draft, { kind: "rect" }>;

export function boxDown(image: Point, screen: Point): RectDraft {
  return { kind: "rect", anchor: image, start: screen, rect: null };
}

export function boxMove(d: RectDraft, screen: Point, view: ViewTransform, image: Size): RectDraft {
  return { ...d, rect: dragRect(d.anchor, d.start, screen, view, image) };
}

export const BOX_TOOL: ToolDefinition = {
  id: "box",
  order: 30,
  action: "box",
  icon: "label",
  label: "Box",
  hint: "Drag with the active type",
  statusHints: "Drag draw · Esc cancel · T type",
  cursor: "crosshair",
  drawsShapes: true,
  onDown: (p, api) => {
    if (p.button === 0) api.store.getState().setDraft(boxDown(p.image, p.screen));
  },
  onMove: (p, api) => {
    const s = api.store.getState();
    if (s.draft?.kind === "rect" && s.image) s.setDraft(boxMove(s.draft, p.screen, s.view, s.image));
  },
  onUp: (_p, api) => {
    const s = api.store.getState();
    const d = s.draft;
    if (d?.kind !== "rect") return;
    s.setDraft(null);
    if (d.rect) void api.createShape({ shape: "box", ...d.rect, angle: 0 });
  },
  onCancel: (api) => {
    if (api.store.getState().draft?.kind !== "rect") return false;
    api.store.getState().setDraft(null);
    return true;
  },
  renderDraft: (d, ctx) =>
    d.kind === "rect" && d.rect ? (
      <KonvaRect
        x={d.rect.x}
        y={d.rect.y}
        width={d.rect.w}
        height={d.rect.h}
        stroke={ctx.colour}
        strokeWidth={2}
        strokeScaleEnabled={false}
        dash={[4, 4]}
        listening={false}
        perfectDrawEnabled={false}
      />
    ) : null,
};
