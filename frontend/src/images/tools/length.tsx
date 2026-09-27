import { Line, Text } from "react-konva";
import { distance, flatten, snapDirection, type Point } from "@/images/canvas/geometry";
import type { Draft } from "@/store/imagesWorkspace";
import { lengthLabel } from "./measure";
import type { ToolDefinition } from "./types";

export const LENGTH_SNAP_DEG = 45;
export type LengthDraft = Extract<Draft, { kind: "length" }>;

const end = (a: Point, p: Point, shift: boolean) => (shift ? snapDirection(a, p, LENGTH_SNAP_DEG) : p);

export function lengthDown(
  d: LengthDraft | null,
  p: Point,
  shift: boolean,
): { draft: LengthDraft | null; commit: [Point, Point] | null } {
  if (!d) return { draft: { kind: "length", a: p, b: null }, commit: null };
  const b = end(d.a, p, shift);
  if (distance(d.a, b) < 1) return { draft: d, commit: null };
  return { draft: null, commit: [d.a, b] };
}

export function lengthMove(d: LengthDraft, p: Point, shift: boolean): LengthDraft {
  return { ...d, b: end(d.a, p, shift) };
}

export const LENGTH_TOOL: ToolDefinition = {
  id: "length",
  order: 70,
  action: "measure-length",
  icon: "measure",
  label: "Measure length",
  hint: "mm from GSD",
  statusHints: "Click start · Click end · Shift 0/45/90° · Esc cancel",
  cursor: "crosshair",
  drawsShapes: true,
  onDown: (p, api) => {
    if (p.button !== 0) return;
    const s = api.store.getState();
    const { draft, commit } = lengthDown(s.draft?.kind === "length" ? s.draft : null, p.image, p.shift);
    s.setDraft(draft);
    if (commit) void api.createMeasurement(commit[0], commit[1]);
  },
  onMove: (p, api) => {
    const s = api.store.getState();
    if (s.draft?.kind === "length") s.setDraft(lengthMove(s.draft, p.image, p.shift));
  },
  onCancel: (api) => {
    if (api.store.getState().draft?.kind !== "length") return false;
    api.store.getState().setDraft(null);
    return true;
  },
  renderDraft: (d, ctx) => {
    if (d.kind !== "length" || !d.b) return null;
    const px = 1 / ctx.scale;
    return (
      <>
        <Line
          points={flatten([d.a, d.b])}
          stroke={ctx.colour}
          strokeWidth={2}
          strokeScaleEnabled={false}
          listening={false}
        />
        <Text
          x={d.b.x + 8 * px}
          y={d.b.y + 8 * px}
          text={lengthLabel(distance(d.a, d.b), ctx.camera)}
          fontSize={12 * px}
          fontFamily="JetBrains Mono Variable, monospace"
          fill={ctx.colour}
          listening={false}
        />
      </>
    );
  },
};
