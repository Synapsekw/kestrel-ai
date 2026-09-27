import { useCallback, useEffect, useMemo, useRef } from "react";
import { Line } from "react-konva";
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import { typeColour } from "@/images/canvas/colours";
import { leaveMs, useAiStore, useVisibility, type Leaving } from "./aiStore";
import { bucketOf, getTool, ShapeNode, useWs, wsGet } from "./bridge";
import { tokenColour } from "./colours";
import { outlineOf, targetOf, visibleSuggestions } from "./suggestions";

/**
 * Layer 3's content (spec §9.1, FC-R8): FC's ShapeNode in its static teal-dash `suggestion` variant,
 * no marching ants (A6). FC's Layer stops listening while the canvas pans; FA mirrors FC's own
 * per-node interactivity (drift.md Task 6) so a drawing tool or Space held reaches the tool, not
 * the suggestion, underneath it.
 */
export function SuggestionsLayer() {
  const boxes = useWs((s) => s.boxes);
  const order = useWs((s) => s.order);
  const focused = useWs((s) => s.focusedSuggestionId);
  const hovered = useWs((s) => s.hoveredId);
  const scale = useWs((s) => s.view.scale);
  const types = useWs((s) => s.types);
  const tool = useWs((s) => s.tool);
  const spaceHeld = useWs((s) => s.spaceHeld);
  const vis = useVisibility();
  const imageId = useWs((s) => s.imageId);
  const leaving = useAiStore((s) => s.leaving);
  const teal = useMemo(() => tokenColour("ok"), []);
  const visible = useMemo(() => visibleSuggestions(boxes, order, vis), [boxes, order, vis]);
  const target = targetOf(visible, focused)?.id ?? null;
  const bucket = bucketOf(scale);
  const nodesInteractive = !(getTool(tool)?.drawsShapes ?? false) && !spaceHeld;

  // One stable identity so ShapeNode's `sameNode` memo holds across pan/zoom frames (drift.md
  // Task 6): reads the store at click time, never a closed-over value.
  const onPointerDown = useCallback((id: string, e: KonvaEventObject<MouseEvent>) => {
    if (e.evt.button !== 0) return; // left button only: a middle press is the pan gesture
    e.cancelBubble = true;
    wsGet().focusSuggestion(id);
  }, []);

  return (
    <>
      {visible.map((b) => (
        <ShapeNode
          key={b.id}
          box={b}
          colour={typeColour(types, b.class_id)}
          variant="suggestion"
          selected={b.id === target}
          hovered={b.id === hovered}
          bucket={bucket}
          scale={scale}
          interactive={nodesInteractive}
          onPointerDown={onPointerDown}
        />
      ))}
      {Object.values(leaving).map((l) =>
        // A ghost belongs to the image it was reviewed on; another image never draws it.
        l.box.image_id === imageId ? <Ghost key={l.box.id} leaving={l} teal={teal} /> : null,
      )}
    </>
  );
}

/**
 * R-FA4b: while the review request is out the outline is `held` (still, teal dash, not listening);
 * the answer starts the accept morph (solid type colour fading out over the new annotation) or the
 * reject fade. Both are opacity tweens (`leaveMs`: dur.fast under reduced motion).
 */
function Ghost({ leaving, teal }: { leaving: Leaving; teal: string }) {
  const ref = useRef<Konva.Line>(null);
  useEffect(() => {
    if (leaving.kind === "held") return;
    ref.current?.to?.({ opacity: 0, duration: leaveMs(leaving.kind) / 1000 });
  }, [leaving.kind]);
  const accept = leaving.kind === "accept";
  return (
    <Line
      ref={ref}
      name={`${leaving.kind === "held" ? "held" : "leaving"} ${leaving.box.id}`}
      points={outlineOf(leaving.box)}
      closed
      stroke={accept ? (leaving.colour ?? teal) : teal}
      strokeWidth={2}
      strokeScaleEnabled={false}
      dash={accept ? undefined : [8, 4]}
      listening={false}
      perfectDrawEnabled={false}
    />
  );
}
