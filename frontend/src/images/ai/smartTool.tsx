/* eslint-disable react-refresh/only-export-components --
   the tool definition is exported next to the preview it draws; not a fast-refresh boundary. */
import { useMemo } from "react";
import { Circle, Group, Line } from "react-konva";
import { SMART_TOOL, type ToolDefinition } from "./bridge";
import { tokenColour } from "./colours";
import { SAM_HINTS } from "./sam/hints";
import { useSamStore } from "./sam/useSmartPolygon";
import { samHandle } from "./samHandle";

/** The dashed teal outline and the prompt points, in screen-px strokes (inside FC's layer 4). */
function SamPreview({ scale }: { scale: number }) {
  const s = useSamStore((x) => x.state);
  const teal = useMemo(() => tokenColour("ok"), []);
  const fill = useMemo(() => tokenColour("ok", 0.15), []);
  const red = useMemo(() => tokenColour("danger"), []);
  const ring = useMemo(() => tokenColour("accent-fg"), []);
  return (
    <Group listening={false} name="sam-preview">
      {s.polygon ? (
        <Line
          points={s.polygon.flat()}
          closed
          stroke={teal}
          fill={fill}
          strokeWidth={2}
          strokeScaleEnabled={false}
          dash={[6, 4]}
        />
      ) : null}
      {s.points.map((p, i) => (
        <Circle
          key={i}
          x={p.x}
          y={p.y}
          radius={5 / scale}
          fill={p.positive ? teal : red}
          stroke={ring}
          strokeWidth={1.5}
          strokeScaleEnabled={false}
        />
      ))}
    </Group>
  );
}

/**
 * Spec §9.2 row S, §10. No `available`: FC's activateTool refuses a tool that reports a reason, and
 * R-FA7 keeps S selectable so the panel can offer "Get model"; the session draws nothing until the
 * weights are ready. FA binds no key of its own: FC dispatches Enter / Backspace / Esc here while the
 * session's `{kind: "custom", tool: "smart"}` draft exists, and Esc without one deselects as usual.
 */
export const SMART_TOOL_DEF: ToolDefinition = {
  id: SMART_TOOL,
  order: 55,
  action: "smart-polygon",
  icon: "sparkle",
  label: "Smart polygon",
  hint: "Click to segment with AI",
  statusHints: SAM_HINTS.join(" · "),
  cursor: "crosshair",
  drawsShapes: true,
  onDown: (p) => {
    if (p.button === 0) samHandle()?.click(p.image, !p.shift);
  },
  onCommit: () => samHandle()?.commit() ?? false,
  onCancel: () => samHandle()?.cancel() ?? false,
  onRemoveVertex: () => samHandle()?.removeLast() ?? false,
  renderDraft: (draft, ctx) =>
    draft.kind === "custom" && draft.tool === SMART_TOOL ? <SamPreview scale={ctx.scale} /> : null,
};
